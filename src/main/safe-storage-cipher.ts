import { safeStorage } from 'electron';
import type { VaultCipher } from './credential-vault.ts';

// 仅用于旧加密文件迁移；不接受旧 basic_text 作为受保护的凭据来源。
const secureLinuxBackends = new Set(['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6']);

export class SafeStorageCipher implements VaultCipher {
  readonly backend: string;

  constructor() {
    try { this.backend = process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : process.platform; }
    catch { this.backend = 'unavailable'; }
  }

  async available(): Promise<boolean> {
    if (process.platform === 'linux' && !secureLinuxBackends.has(this.backend)) return false;
    try { return await safeStorage.isAsyncEncryptionAvailable(); } catch { return false; }
  }

  async encrypt(value: string): Promise<string> {
    const encrypted = await safeStorage.encryptStringAsync(value);
    return encrypted.toString('base64');
  }

  async decrypt(value: string): Promise<string> {
    const { result } = await safeStorage.decryptStringAsync(Buffer.from(value, 'base64'));
    return result;
  }
}
