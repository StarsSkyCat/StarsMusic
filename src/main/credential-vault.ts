import { emptyCredentials, parseStoredCredentials, type CredentialStore, type StoredCredentials } from '../../packages/storage/src/credential-store.ts';
import { DomainError, type AppError, appError } from '../../packages/contracts/src/errors.ts';
import {
  credentialProviderIds, parseCredentialBundle, type CredentialBundle, type CredentialProvider, type CredentialStatus,
} from '../../packages/contracts/src/credentials.ts';

export interface VaultCipher {
  readonly backend: string;
  available(): Promise<boolean>;
  encrypt(value: string): Promise<string>;
  decrypt(value: string): Promise<string>;
  reset?(): Promise<void>;
}

export class CredentialVault {
  readonly #store: CredentialStore;
  readonly #cipher: VaultCipher;
  readonly #now: () => number;
  #state: StoredCredentials | undefined;
  #locked = false;
  #error: AppError | undefined;
  #queue: Promise<void> = Promise.resolve();
  #epoch = 0;
  #providerEpoch: Record<CredentialProvider, number> = { netease: 0, kugou: 0 };

  constructor(store: CredentialStore, cipher: VaultCipher, now: () => number = Date.now) {
    this.#store = store; this.#cipher = cipher; this.#now = now;
  }

  async #ready(): Promise<StoredCredentials> {
    if (this.#locked) throw new DomainError('credential-locked');
    if (this.#state) return this.#state;
    try {
      const stored = await this.#store.read();
      this.#state = stored === undefined ? emptyCredentials() : parseStoredCredentials(stored);
    } catch {
      this.#locked = true; this.#error = appError('credential-locked');
      throw new DomainError('credential-locked');
    }
    return this.#state;
  }

  async #available(): Promise<boolean> {
    try { return await this.#cipher.available(); } catch { return false; }
  }

  async #mutate(change: (state: StoredCredentials) => StoredCredentials | undefined): Promise<boolean> {
    const operation = this.#queue.then(async () => {
      if (!this.#state) throw new Error('vault.not-ready');
      const next = change(this.#state);
      if (!next) return false;
      await this.#store.write(next);
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
    let ready: StoredCredentials | undefined;
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
    if (!value) this.#epoch++;
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
    const epoch = this.#epoch; const providerEpoch = this.#providerEpoch[bundle.provider];
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
    return this.#mutate((current) => current.remember && epoch === this.#epoch && providerEpoch === this.#providerEpoch[bundle.provider] ? {
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
    this.#providerEpoch[provider]++;
    await this.#ready();
    await this.#mutate((state) => {
      if (!state.entries[provider]) return undefined;
      const entries = { ...state.entries };
      delete entries[provider];
      return { ...state, entries };
    });
  }

  async close(): Promise<void> {
    this.#epoch++;
    await this.#queue;
    await this.#store.close();
  }

  async clear(): Promise<CredentialStatus> {
    this.#epoch++;
    const operation = this.#queue.then(async () => {
      await this.#store.reset();
      await this.#cipher.reset?.();
      this.#state = emptyCredentials(); this.#locked = false; this.#error = undefined;
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
