import { constants } from 'node:fs';
import { chmod, mkdir, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { credentialProviderIds, type CredentialProvider } from '../../contracts/src/credentials.ts';

export interface StoredEntry {
  readonly ciphertext: string;
  readonly updatedAt: number;
}
export interface StoredCredentials {
  readonly version: 1;
  readonly remember: boolean;
  readonly entries: Partial<Record<CredentialProvider, StoredEntry>>;
}
export interface CredentialStore {
  read(): Promise<StoredCredentials | undefined>;
  write(value: StoredCredentials): Promise<void>;
  close(): Promise<void>;
  reset(): Promise<void>;
}
export function emptyCredentials(): StoredCredentials {
  return { version: 1, remember: false, entries: {} };
}
export function parseStoredCredentials(value: unknown): StoredCredentials {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('vault.invalid');
  const input = value as Record<string, unknown>;
  if (
    input.version !== 1 ||
    typeof input.remember !== 'boolean' ||
    typeof input.entries !== 'object' ||
    input.entries === null ||
    Array.isArray(input.entries)
  )
    throw new Error('vault.invalid');
  const entries: Partial<Record<CredentialProvider, StoredEntry>> = {};
  for (const provider of credentialProviderIds) {
    const value = (input.entries as Record<string, unknown>)[provider];
    if (value === undefined) continue;
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      throw new Error('vault.invalid');
    const entry = value as Record<string, unknown>;
    if (
      typeof entry.ciphertext !== 'string' ||
      !entry.ciphertext ||
      entry.ciphertext.length > 500_000 ||
      typeof entry.updatedAt !== 'number' ||
      !Number.isSafeInteger(entry.updatedAt) ||
      entry.updatedAt < 0
    )
      throw new Error('vault.invalid');
    entries[provider] = { ciphertext: entry.ciphertext, updatedAt: entry.updatedAt };
  }
  if (!input.remember && Object.keys(entries).length) throw new Error('vault.invalid');
  return { version: 1, remember: input.remember, entries };
}

// 同步 SQLite 只在专用 Node worker 中运行，不在 Electron 窗口主线程执行。
export class SqliteCredentialStore implements CredentialStore {
  readonly #file: string;
  #database: Promise<DatabaseSync> | undefined;
  #closed = false;
  constructor(file: string) {
    this.#file = file;
  }
  #open(): Promise<DatabaseSync> {
    if (this.#closed) return Promise.reject(new Error('vault.closed'));
    return (this.#database ??= this.#create());
  }
  async #create(): Promise<DatabaseSync> {
    await mkdir(path.dirname(this.#file), { recursive: true, mode: 0o700 });
    await chmod(path.dirname(this.#file), 0o700);
    const file = await open(
      this.#file,
      constants.O_RDWR | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    try {
      if (!(await file.stat()).isFile()) throw new Error('vault.invalid');
      await file.chmod(0o600);
    } finally {
      await file.close();
    }
    const database = new DatabaseSync(this.#file, { enableDoubleQuotedStringLiterals: false });
    try {
      const version = database.prepare('PRAGMA user_version').get()?.user_version;
      const application = database.prepare('PRAGMA application_id').get()?.application_id;
      if ((version !== 0 && version !== 1) || (application !== 0 && application !== 0x53544d43))
        throw new Error('vault.version');
      if (
        version === 0 &&
        database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' LIMIT 1").get()
      )
        throw new Error('vault.schema');
      database.exec(
        'PRAGMA trusted_schema=OFF; PRAGMA secure_delete=ON; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA busy_timeout=2000;',
      );
      if (version === 0)
        database.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK(id = 1), remember INTEGER NOT NULL CHECK(remember IN (0,1))) STRICT;
        CREATE TABLE credentials (provider TEXT PRIMARY KEY CHECK(provider IN ('netease','kugou')), ciphertext TEXT NOT NULL CHECK(length(ciphertext) BETWEEN 1 AND 500000), updated_at INTEGER NOT NULL CHECK(updated_at >= 0)) STRICT;
        PRAGMA application_id=0x53544d43;
        PRAGMA user_version=1;
        COMMIT;
      `);
      await chmod(this.#file, 0o600);
      return database;
    } catch (error) {
      database.close();
      throw error;
    }
  }
  async read(): Promise<StoredCredentials | undefined> {
    const database = await this.#open();
    const settings = database.prepare('SELECT remember FROM settings WHERE id = 1').get();
    if (!settings) return undefined;
    const entries: Partial<Record<CredentialProvider, StoredEntry>> = {};
    for (const row of database
      .prepare('SELECT provider, ciphertext, updated_at FROM credentials')
      .all()) {
      if (!credentialProviderIds.includes(row.provider as CredentialProvider))
        throw new Error('vault.invalid');
      entries[row.provider as CredentialProvider] = {
        ciphertext: row.ciphertext as string,
        updatedAt: row.updated_at as number,
      };
    }
    return parseStoredCredentials({ version: 1, remember: settings.remember === 1, entries });
  }
  async write(value: StoredCredentials): Promise<void> {
    const state = parseStoredCredentials(value);
    const database = await this.#open();
    await chmod(this.#file, 0o600);
    database.exec('BEGIN IMMEDIATE');
    try {
      database
        .prepare(
          'INSERT INTO settings(id, remember) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET remember=excluded.remember',
        )
        .run(state.remember ? 1 : 0);
      database.exec('DELETE FROM credentials');
      const insert = database.prepare(
        'INSERT INTO credentials(provider, ciphertext, updated_at) VALUES(?, ?, ?)',
      );
      for (const provider of credentialProviderIds) {
        const entry = state.entries[provider];
        if (entry) insert.run(provider, entry.ciphertext, entry.updatedAt);
      }
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
  async reset(): Promise<void> {
    const database = await this.#database?.catch(() => undefined);
    database?.close();
    this.#database = undefined;
    for (const suffix of ['', '-journal', '-wal', '-shm']) {
      await unlink(`${this.#file}${suffix}`).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      });
    }
    await this.write(emptyCredentials());
  }
  async close(): Promise<void> {
    this.#closed = true;
    const database = await this.#database?.catch(() => undefined);
    database?.close();
    this.#database = undefined;
  }
}
