import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseThemePreference, type ThemePreference } from '../../packages/contracts/src/appearance.ts';

// 仅保存公开的外观枚举，不接受 renderer 提供的路径或任意设置字段。
export class AppearanceStore {
  private readonly file: string;
  private preference: ThemePreference = 'system';
  private writes: Promise<unknown> = Promise.resolve();

  constructor(file: string) { this.file = file; }

  async initialize(): Promise<void> {
    try {
      const value: unknown = JSON.parse(await readFile(this.file, 'utf8'));
      if (typeof value === 'object' && value !== null && Reflect.get(value, 'version') === 1)
        this.preference = parseThemePreference(Reflect.get(value, 'theme'));
    } catch { /* 缺失、旧版本或损坏设置使用系统外观，不影响启动。 */ }
  }

  getPreference(): ThemePreference { return this.preference; }

  setPreference(input: unknown): Promise<ThemePreference> {
    const preference = parseThemePreference(input);
    const pending = this.writes.catch(() => undefined).then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
      await writeFile(`${this.file}.tmp`, JSON.stringify({ version: 1, theme: preference }) + '\n', { mode: 0o600 });
      await rename(`${this.file}.tmp`, this.file);
      this.preference = preference;
      return preference;
    });
    this.writes = pending;
    return pending;
  }
}
