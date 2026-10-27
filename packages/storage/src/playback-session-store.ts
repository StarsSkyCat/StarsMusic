import { constants } from 'node:fs';
import { chmod, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseStoredPlaybackSession, type StoredPlaybackSession } from '../../contracts/src/playback-session.ts';

export interface PlaybackSessionStore {
  read(): Promise<StoredPlaybackSession | undefined>;
  write(value: StoredPlaybackSession): Promise<void>;
  close(): Promise<void>;
}
// 与登录密文分库；同步 SQLite 只在专用 worker 中执行。
export class SqlitePlaybackSessionStore implements PlaybackSessionStore {
  #database: Promise<DatabaseSync> | undefined;
  #closed = false;
  readonly file: string;
  constructor(file: string) { this.file = file; }
  #open(): Promise<DatabaseSync> {
    if (this.#closed) return Promise.reject(new Error('playback.storage-closed'));
    return this.#database ??= this.#create();
  }
  async #create(): Promise<DatabaseSync> {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    await chmod(path.dirname(this.file), 0o700);
    const file = await open(this.file, constants.O_RDWR | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0), 0o600);
    try { if (!(await file.stat()).isFile()) throw new Error('playback.storage-invalid'); await file.chmod(0o600); }
    finally { await file.close(); }
    const db = new DatabaseSync(this.file, { enableDoubleQuotedStringLiterals: false });
    try {
      const version = db.prepare('PRAGMA user_version').get()?.user_version;
      const application = db.prepare('PRAGMA application_id').get()?.application_id;
      if ((version !== 0 && version !== 1) || (application !== 0 && application !== 0x53544d50)) throw new Error('playback.storage-version');
      if (version === 0 && db.prepare("SELECT name FROM sqlite_master WHERE type='table' LIMIT 1").get()) throw new Error('playback.storage-schema');
      db.exec('PRAGMA trusted_schema=OFF; PRAGMA secure_delete=ON; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA busy_timeout=2000;');
      if (version === 0) db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE playback_session(id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL CHECK(length(value) <= 33554432)) STRICT;
        PRAGMA application_id=0x53544d50; PRAGMA user_version=1; COMMIT;`);
      return db;
    } catch (error) { db.close(); throw error; }
  }
  async read(): Promise<StoredPlaybackSession | undefined> {
    const row = (await this.#open()).prepare('SELECT value FROM playback_session WHERE id=1').get();
    if (!row) return undefined;
    if (typeof row.value !== 'string' || row.value.length > 33554432) throw new Error('playback.storage-invalid');
    return parseStoredPlaybackSession(JSON.parse(row.value) as unknown);
  }
  async write(value: StoredPlaybackSession): Promise<void> {
    const json = JSON.stringify(parseStoredPlaybackSession(value));
    if (Buffer.byteLength(json) > 33554432) throw new Error('playback.storage-size');
    const db = await this.#open(); await chmod(this.file, 0o600);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('INSERT INTO playback_session(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(json);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  async close(): Promise<void> {
    this.#closed = true;
    (await this.#database?.catch(() => undefined))?.close(); this.#database = undefined;
  }
}
