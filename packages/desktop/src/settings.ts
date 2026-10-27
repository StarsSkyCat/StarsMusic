import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { defaultSystemPreferences, parseSystemPreferences, type SystemPreferences } from '../../contracts/src/system.ts';

export class DesktopSettings {
  #file: string; #preferences = defaultSystemPreferences(); #writes: Promise<unknown> = Promise.resolve(); #writable = true;
  constructor(file: string) { this.#file = file; }
  snapshot(): SystemPreferences { return { ...this.#preferences }; }
  async initialize(): Promise<boolean> {
    try {
      const raw: unknown = JSON.parse(await readFile(this.#file, 'utf8'));
      if (typeof raw !== 'object' || raw === null || Reflect.get(raw, 'version') !== 1) throw new Error('desktop.settings-version');
      this.#preferences = parseSystemPreferences(Reflect.get(raw, 'preferences')); return true;
    } catch (error: unknown) {
      this.#writable = (error as NodeJS.ErrnoException).code === 'ENOENT'; return this.#writable;
    }
  }
  write(value: SystemPreferences): Promise<void> {
    const preferences = parseSystemPreferences(value);
    const pending = this.#writes.catch(() => undefined).then(async () => {
      if (!this.#writable) throw new Error('desktop.settings-invalid');
      await mkdir(path.dirname(this.#file), { recursive: true, mode: 0o700 });
      const temporary = `${this.#file}.${randomUUID()}.tmp`;
      const file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
      try {
        try { await file.writeFile(JSON.stringify({ version: 1, preferences }) + '\n'); await file.sync(); }
        finally { await file.close(); }
        await rename(temporary, this.#file); this.#preferences = preferences;
      } finally { await unlink(temporary).catch(() => undefined); }
    }); this.#writes = pending; return pending;
  }
  async close(): Promise<void> { await this.#writes.catch(() => undefined); }
}
