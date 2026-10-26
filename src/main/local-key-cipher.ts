import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, link, mkdir, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { VaultCipher } from './credential-vault.ts';

const aad = Buffer.from('StarsMusic/credentials/aes-256-gcm/v1', 'utf8');

// 本地密钥避免桌面服务依赖，但不提供系统密钥库的隔离保护；UI 明确说明边界。
export class LocalKeyCipher implements VaultCipher {
  readonly backend = 'local-key-aes-256-gcm';
  readonly #file: string;
  readonly #hasEntries: () => Promise<boolean>;
  #key: Promise<Buffer> | undefined;
  constructor(file: string, hasEntries: () => Promise<boolean>) {
    this.#file = file;
    this.#hasEntries = hasEntries;
  }
  async #directory(): Promise<void> {
    await mkdir(path.dirname(this.#file), { recursive: true, mode: 0o700 });
    await chmod(path.dirname(this.#file), 0o700);
  }
  async #read(): Promise<Buffer | undefined> {
    let handle;
    try {
      handle = await open(this.#file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size !== 32) throw new Error('vault.key-invalid');
      await handle.chmod(0o600);
      const key = await handle.readFile();
      if (key.length !== 32) throw new Error('vault.key-invalid');
      return key;
    } finally {
      await handle.close();
    }
  }
  async available(): Promise<boolean> {
    try {
      await this.#directory();
      const key = await this.#read();
      if (key) {
        key.fill(0);
        return true;
      }
      // 已有密文时不能生成新密钥覆盖丢失的旧密钥。
      return !(await this.#hasEntries());
    } catch {
      return false;
    }
  }
  async #load(create: boolean): Promise<Buffer> {
    const existing = await this.#read();
    if (existing) return existing;
    if (!create || (await this.#hasEntries())) throw new Error('vault.key-missing');
    await this.#directory();
    const temporary = `${this.#file}.${randomBytes(8).toString('hex')}.tmp`;
    const key = randomBytes(32);
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(key);
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await link(temporary, this.#file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    } finally {
      key.fill(0);
      await unlink(temporary).catch(() => undefined);
    }
    const stored = await this.#read();
    if (!stored) throw new Error('vault.key-missing');
    return stored;
  }
  async #getKey(create: boolean): Promise<Buffer> {
    const pending = this.#key ??= this.#load(create);
    try { return await pending; }
    catch (error) { if (this.#key === pending) this.#key = undefined; throw error; }
  }
  async encrypt(value: string): Promise<string> {
    const key = await this.#getKey(true);
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(aad);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return `v1:${Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64')}`;
  }
  async decrypt(value: string): Promise<string> {
    if (!/^v1:[A-Za-z0-9+/]+=*$/.test(value) || value.length > 500_000)
      throw new Error('vault.ciphertext-invalid');
    const bytes = Buffer.from(value.slice(3), 'base64');
    if (bytes.length <= 28) throw new Error('vault.ciphertext-invalid');
    const key = await this.#getKey(false);
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    decipher.setAAD(aad);
    decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
  }
  async reset(): Promise<void> {
    const key = await this.#key?.catch(() => undefined);
    key?.fill(0);
    this.#key = undefined;
    await unlink(this.#file).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
  }
}
