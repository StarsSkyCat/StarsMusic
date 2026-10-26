import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DomainError, type AppError, appError } from '../../packages/contracts/src/errors.ts';
import {
  credentialProviderIds, parseCredentialBundle, type CredentialBundle, type CredentialProvider, type CredentialStatus,
} from '../../packages/contracts/src/credentials.ts';

export interface VaultCipher {
  readonly backend: string;
  available(): Promise<boolean>;
  encrypt(value: string): Promise<string>;
  decrypt(value: string): Promise<string>;
}

interface StoredEntry { readonly ciphertext: string; readonly updatedAt: number }
interface StoredFile {
  version: 1;
  remember: boolean;
  entries: Partial<Record<CredentialProvider, StoredEntry>>;
}

function emptyFile(): StoredFile { return { version: 1, remember: false, entries: {} }; }
function validEntry(value: unknown): value is StoredEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.ciphertext === 'string' && entry.ciphertext.length > 0 && entry.ciphertext.length <= 500_000
    && typeof entry.updatedAt === 'number' && Number.isSafeInteger(entry.updatedAt) && entry.updatedAt >= 0;
}
function parseStoredFile(value: unknown): StoredFile {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('vault.invalid');
  const input = value as Record<string, unknown>;
  if (input.version !== 1 || typeof input.remember !== 'boolean'
    || typeof input.entries !== 'object' || input.entries === null || Array.isArray(input.entries)) throw new Error('vault.invalid');
  const entries: Partial<Record<CredentialProvider, StoredEntry>> = {};
  for (const provider of credentialProviderIds) {
    const entry = (input.entries as Record<string, unknown>)[provider];
    if (entry === undefined) continue;
    if (!validEntry(entry)) throw new Error('vault.invalid');
    entries[provider] = { ciphertext: entry.ciphertext, updatedAt: entry.updatedAt };
  }
  return { version: 1, remember: input.remember, entries };
}

export class CredentialVault {
  readonly #file: string;
  readonly #cipher: VaultCipher;
  readonly #now: () => number;
  #state: StoredFile | undefined;
  #locked = false;
  #error: AppError | undefined;
  #queue: Promise<void> = Promise.resolve();

  constructor(file: string, cipher: VaultCipher, now: () => number = Date.now) {
    this.#file = file; this.#cipher = cipher; this.#now = now;
  }

  async #ready(): Promise<StoredFile> {
    if (this.#locked) throw new DomainError('credential-locked');
    if (this.#state) return this.#state;
    try {
      const content = await readFile(this.#file, 'utf8');
      this.#state = parseStoredFile(JSON.parse(content) as unknown);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.#state = emptyFile();
      } else {
        this.#locked = true; this.#error = appError('credential-locked');
        throw new DomainError('credential-locked');
      }
    }
    return this.#state;
  }

  async #available(): Promise<boolean> {
    try { return await this.#cipher.available(); } catch { return false; }
  }

  async #writeNow(next: StoredFile): Promise<void> {
    const directory = path.dirname(this.#file);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700).catch(() => undefined);
    const temporary = `${this.#file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      await chmod(temporary, 0o600);
      await rename(temporary, this.#file);
      await chmod(this.#file, 0o600);
    } catch (error: unknown) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  async #mutate(change: (state: StoredFile) => StoredFile | undefined): Promise<boolean> {
    const operation = this.#queue.then(async () => {
      if (!this.#state) throw new Error('vault.not-ready');
      const next = change(this.#state);
      if (!next) return false;
      await this.#writeNow(next);
      this.#state = next; this.#error = undefined;
      return true;
    });
    this.#queue = operation.then(() => undefined).catch(() => undefined);
    try { return await operation; }
    catch {
      this.#error = appError('credential-save-failed');
      throw new DomainError('credential-save-failed');
    }
  }

  async status(): Promise<CredentialStatus> {
    let ready: StoredFile | undefined;
    try { ready = await this.#ready(); } catch { ready = undefined; }
    const available = !this.#locked && await this.#available();
    if (!available && !this.#error && !this.#locked) this.#error = appError('credential-unavailable');
    const entries = ready?.entries ?? {};
    return Object.freeze({
      available, backend: this.#cipher.backend, remembered: ready?.remember === true,
      locked: this.#locked, savedProviders: Object.freeze(credentialProviderIds.filter((provider) => entries[provider] !== undefined)),
      ...(this.#error === undefined ? {} : { error: this.#error }),
    });
  }

  async setRemember(value: boolean): Promise<CredentialStatus> {
    await this.#ready();
    if (value) {
      if (!await this.#available()) {
        this.#error = appError('credential-unavailable');
        throw new DomainError('credential-unavailable');
      }
      await this.#mutate((state) => state.remember ? undefined : { ...state, remember: true });
    } else {
      await this.#mutate((state) => state.remember || Object.keys(state.entries).length > 0 ? { ...state, remember: false, entries: {} } : undefined);
    }
    return this.status();
  }

  async save(bundle: CredentialBundle): Promise<boolean> {
    const state = await this.#ready();
    if (!state.remember) return false;
    if (!await this.#available()) {
      this.#error = appError('credential-unavailable');
      throw new DomainError('credential-unavailable');
    }
    let ciphertext: string;
    try { ciphertext = await this.#cipher.encrypt(JSON.stringify(bundle)); }
    catch {
      this.#error = appError('credential-save-failed');
      throw new DomainError('credential-save-failed');
    }
    if (!ciphertext || ciphertext.length > 500_000) throw new DomainError('credential-save-failed');
    return this.#mutate((current) => current.remember ? {
      ...current, entries: { ...current.entries, [bundle.provider]: { ciphertext, updatedAt: this.#now() } },
    } : undefined);
  }

  async load(provider: CredentialProvider): Promise<CredentialBundle | undefined> {
    const state = await this.#ready();
    if (!state.remember) return undefined;
    const entry = state.entries[provider];
    if (!entry) return undefined;
    if (!await this.#available()) {
      this.#error = appError('credential-unavailable');
      throw new DomainError('credential-unavailable');
    }
    let plaintext: string;
    try { plaintext = await this.#cipher.decrypt(entry.ciphertext); }
    catch {
      this.#locked = true; this.#error = appError('credential-locked');
      throw new DomainError('credential-locked');
    }
    try {
      const bundle = parseCredentialBundle(JSON.parse(plaintext) as unknown);
      if (bundle.provider !== provider) throw new Error('vault.provider');
      return bundle;
    } catch {
      this.#locked = true; this.#error = appError('credential-locked');
      throw new DomainError('credential-locked');
    }
  }

  async remove(provider: CredentialProvider): Promise<void> {
    await this.#ready();
    await this.#mutate((state) => {
      if (!state.entries[provider]) return undefined;
      const entries = { ...state.entries };
      delete entries[provider];
      return { ...state, entries };
    });
  }

  async clear(): Promise<CredentialStatus> {
    const operation = this.#queue.then(async () => {
      await this.#writeNow(emptyFile());
      this.#state = emptyFile(); this.#locked = false; this.#error = undefined;
    });
    this.#queue = operation.then(() => undefined).catch(() => undefined);
    try { await operation; }
    catch {
      this.#error = appError('credential-save-failed');
      throw new DomainError('credential-save-failed');
    }
    return this.status();
  }
}
