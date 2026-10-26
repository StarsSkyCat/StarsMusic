import { constants } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import { parseCredentialBundle } from '../../packages/contracts/src/credentials.ts';
import {
  emptyCredentials,
  parseStoredCredentials,
  type CredentialStore,
  type StoredCredentials,
} from '../../packages/storage/src/credential-store.ts';
import type { VaultCipher } from './credential-vault.ts';

// 只有新库从未写入时导入；旧密钥不可用/导入失败保留原文件，允许用户重新扫码。
export async function migrateLegacyCredentials(
  store: CredentialStore,
  cipher: VaultCipher,
  legacyCipher: VaultCipher,
  file: string,
): Promise<void> {
  if ((await store.read()) !== undefined) return;
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  let legacy: StoredCredentials;
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 1_100_000) throw new Error('vault.legacy-invalid');
    legacy = parseStoredCredentials(JSON.parse(await handle.readFile('utf8')) as unknown);
  } finally {
    await handle.close();
  }
  if (!legacy.remember) {
    await store.write(emptyCredentials());
    await unlink(file);
    return;
  }
  if (!(await legacyCipher.available())) return;
  const entries: StoredCredentials['entries'] = {};
  for (const provider of ['netease', 'kugou'] as const) {
    const entry = legacy.entries[provider];
    if (!entry) continue;
    const bundle = parseCredentialBundle(
      JSON.parse(await legacyCipher.decrypt(entry.ciphertext)) as unknown,
    );
    if (bundle.provider !== provider) throw new Error('vault.legacy-invalid');
    entries[provider] = {
      ciphertext: await cipher.encrypt(JSON.stringify(bundle)),
      updatedAt: entry.updatedAt,
    };
  }
  await store.write({ version: 1, remember: true, entries });
  // 数据库事务提交后才删除旧副本；删除失败不影响已完成的导入。
  await unlink(file).catch(() => undefined);
}
