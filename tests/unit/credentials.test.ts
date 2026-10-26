import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DomainError } from '../../packages/contracts/src/errors.ts';
import {
  credentialChannels, parseCredentialArguments, parseCredentialBundle, parseCredentialStatus,
  type KugouCredentialBundle, type NeteaseCredentialBundle,
} from '../../packages/contracts/src/credentials.ts';
import { CredentialVault, type VaultCipher } from '../../src/main/credential-vault.ts';

// 明确标识的合成凭据；不连接平台，也不写入真实用户目录。
const neteaseBundle: NeteaseCredentialBundle = {
  provider: 'netease', version: 1, clientChannel: 'netease-app', accountId: '42', nickname: '合成账号',
  cookies: { MUSIC_U: 'synthetic-music-u', __csrf: 'synthetic-csrf' }, deviceId: 'synthetic-device', nuid: 'a'.repeat(32), savedAt: 1000,
};
const kugouBundle: KugouCredentialBundle = {
  provider: 'kugou', version: 1, clientChannel: 'kugou-app', accountId: '43', nickname: '合成酷狗账号',
  userid: '43', token: 'synthetic-token', dfid: 'synthetic-dfid', guid: '00000000-0000-4000-8000-000000000000', savedAt: 1000,
};
class FakeCipher implements VaultCipher {
  readonly backend = 'fake-keyring';
  availableFlag: boolean;
  failDecrypt = false;
  constructor(available = true) { this.availableFlag = available; }
  async available(): Promise<boolean> { return this.availableFlag; }
  async encrypt(value: string): Promise<string> { return Buffer.from(`encrypted:${value}`, 'utf8').toString('base64'); }
  async decrypt(value: string): Promise<string> {
    if (this.failDecrypt) throw new Error('synthetic decrypt failure');
    const text = Buffer.from(value, 'base64').toString('utf8');
    if (!text.startsWith('encrypted:')) throw new Error('synthetic invalid ciphertext');
    return text.slice('encrypted:'.length);
  }
}
async function temporaryVault(cipher = new FakeCipher(), now = () => 1000) {
  const directory = await mkdtemp(path.join(tmpdir(), 'starsmusic-vault-'));
  const file = path.join(directory, 'credentials.json');
  return { directory, file, vault: new CredentialVault(file, cipher, now) };
}

test('凭据 bundle 只接受白名单字段和格式', () => {
  assert.deepEqual(parseCredentialBundle(neteaseBundle), neteaseBundle);
  assert.deepEqual(parseCredentialBundle(kugouBundle), kugouBundle);
  assert.throws(() => parseCredentialBundle({ ...neteaseBundle, cookies: { __csrf: 'x' } }));
  assert.throws(() => parseCredentialBundle({ ...neteaseBundle, cookies: { ...neteaseBundle.cookies, token: 'x' } }));
  assert.equal('extra' in parseCredentialBundle({ ...neteaseBundle, extra: 'synthetic' }), false);
  assert.throws(() => parseCredentialBundle({ ...kugouBundle, userid: '44' }));
  assert.throws(() => parseCredentialBundle({ ...kugouBundle, token: 'bad token' }));
  assert.throws(() => parseCredentialBundle({ ...kugouBundle, guid: 'not-a-uuid' }));
  assert.throws(() => parseCredentialBundle({ ...kugouBundle, provider: 'netease' }));
  assert.equal(parseCredentialStatus({ available: true, backend: 'fake', remembered: false, locked: false, savedProviders: ['netease', 'netease'] }).savedProviders.length, 1);
  assert.throws(() => parseCredentialStatus({ available: true, backend: 'fake', remembered: false, locked: false, savedProviders: ['other'] }));
  assert.equal(parseCredentialArguments(credentialChannels.setRemember, [true]), true);
  assert.deepEqual(parseCredentialArguments(credentialChannels.getStatus, []), undefined);
  assert.throws(() => parseCredentialArguments(credentialChannels.setRemember, ['true']));
  assert.throws(() => parseCredentialArguments(credentialChannels.clear, ['extra']));
});

test('凭据文件只保存系统密钥密文，并支持保存/读取/删除/关闭记住', async () => {
  const { directory, file, vault } = await temporaryVault();
  try {
    const initial = await vault.status();
    assert.equal(initial.available, true); assert.equal(initial.remembered, false); assert.deepEqual(initial.savedProviders, []);
    await vault.setRemember(true);
    await Promise.all([vault.save(neteaseBundle), vault.save(kugouBundle)]);
    const status = await vault.status();
    assert.deepEqual(status.savedProviders, ['netease', 'kugou']);
    const content = await readFile(file, 'utf8');
    assert.ok(!content.includes('synthetic-token'));
    assert.ok(!content.includes('synthetic-music-u'));
    assert.deepEqual(await vault.load('netease'), neteaseBundle);
    assert.deepEqual(await vault.load('kugou'), kugouBundle);
    if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);
    await vault.remove('netease');
    assert.equal(await vault.load('netease'), undefined);
    assert.deepEqual((await vault.status()).savedProviders, ['kugou']);
    await vault.setRemember(false);
    assert.equal(await vault.load('kugou'), undefined);
    const closed = await vault.status();
    assert.equal(closed.remembered, false); assert.deepEqual(closed.savedProviders, []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('系统密钥不可用时不写文件，也不假装启用记住登录', async () => {
  const cipher = new FakeCipher(false); const { directory, file, vault } = await temporaryVault(cipher);
  try {
    const status = await vault.status();
    assert.equal(status.available, false); assert.equal(status.backend, 'fake-keyring');
    await assert.rejects(vault.setRemember(true), (error: unknown) => error instanceof DomainError && error.code === 'credential-unavailable');
    assert.equal(await vault.save(neteaseBundle), false);
    assert.equal(await vault.load('netease'), undefined);
    await assert.rejects(stat(file));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('密文损坏或解密失败进入锁定状态，清除后恢复可用', async () => {
  const { directory, file, vault } = await temporaryVault();
  try {
    await vault.setRemember(true); await vault.save(neteaseBundle);
    const stored = JSON.parse(await readFile(file, 'utf8')) as { entries: { netease: { ciphertext: string } } };
    stored.entries.netease.ciphertext = Buffer.from('tampered', 'utf8').toString('base64');
    await writeFile(file, JSON.stringify(stored), { mode: 0o600 });
    const reopened = new CredentialVault(file, new FakeCipher(), () => 2000);
    await assert.rejects(reopened.load('netease'), (error: unknown) => error instanceof DomainError && error.code === 'credential-locked');
    const locked = await reopened.status();
    assert.equal(locked.locked, true); assert.equal(locked.available, false);
    const cleared = await reopened.clear();
    assert.equal(cleared.locked, false); assert.equal(cleared.remembered, false);
    assert.equal((await reopened.status()).available, true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});


test('退出、清除或关闭后重新开启记住登录，都不会被迟到加密写回旧账号', async () => {
  for (const mode of ['logout', 'clear', 'toggle'] as const) {
    let release!: () => void;
    const barrier = new Promise<void>(done => { release = done; });
    const cipher = new FakeCipher();
    const encrypt = cipher.encrypt.bind(cipher);
    cipher.encrypt = async value => { await barrier; return encrypt(value); };
    const { directory, vault } = await temporaryVault(cipher);
    try {
      await vault.setRemember(true);
      const pending = vault.save(kugouBundle);
      await new Promise<void>(done => setImmediate(done));
      if (mode === 'logout') await vault.remove('kugou');
      else if (mode === 'clear') await vault.clear();
      else { await vault.setRemember(false); await vault.setRemember(true); }
      release();
      assert.equal(await pending, false);
      assert.deepEqual((await vault.status()).savedProviders, []);
      assert.equal(await vault.load('kugou'), undefined);
    } finally { release(); await rm(directory, { recursive: true, force: true }); }
  }
});

test('重建保险库仍能恢复双平台密文保存项，各平台独立删除', async () => {
  const { directory, file, vault } = await temporaryVault();
  try {
    await vault.setRemember(true); await vault.save(neteaseBundle); await vault.save(kugouBundle);
    const restarted = new CredentialVault(file, new FakeCipher());
    assert.equal((await restarted.status()).remembered, true);
    assert.deepEqual(await restarted.load('netease'), neteaseBundle);
    assert.deepEqual(await restarted.load('kugou'), kugouBundle);
    await restarted.remove('kugou');
    assert.deepEqual(await restarted.load('netease'), neteaseBundle);
    assert.equal(await restarted.load('kugou'), undefined);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
