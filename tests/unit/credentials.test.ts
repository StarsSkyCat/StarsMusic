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
import { DatabaseSync } from 'node:sqlite';
import { SqliteCredentialStore } from '../../packages/storage/src/credential-store.ts';
import { LocalKeyCipher } from '../../src/main/local-key-cipher.ts';
import { migrateLegacyCredentials } from '../../src/main/credential-migration.ts';
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
const openStores = new Map<string, SqliteCredentialStore[]>();
function openStore(file: string): SqliteCredentialStore {
  const store = new SqliteCredentialStore(file);
  const directory = path.dirname(file);
  openStores.set(directory, [...(openStores.get(directory) ?? []), store]);
  return store;
}
async function cleanup(directory: string): Promise<void> {
  for (const store of openStores.get(directory) ?? []) await store.close();
  openStores.delete(directory);
  await rm(directory, { recursive: true, force: true });
}
async function rememberBoth(vault: CredentialVault, value: boolean): Promise<void> {
  await vault.setRemember('netease', value);
  await vault.setRemember('kugou', value);
}
async function temporaryVault(cipher: VaultCipher = new FakeCipher(), now = () => 1000) {
  const directory = await mkdtemp(path.join(tmpdir(), 'starsmusic-vault-'));
  const file = path.join(directory, 'credentials.sqlite');
  return { directory, file, vault: new CredentialVault(openStore(file), cipher, now) };
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
  assert.equal(parseCredentialStatus({ revision: 0, rememberedProviders: [], available: true, backend: 'fake', remembered: false, locked: false, savedProviders: ['netease', 'netease'] }).savedProviders.length, 1);
  assert.throws(() => parseCredentialStatus({ revision: 0, rememberedProviders: [], available: true, backend: 'fake', remembered: false, locked: false, savedProviders: ['other'] }));
  assert.deepEqual(parseCredentialArguments(credentialChannels.setRemember, ['kugou', true]), { provider: 'kugou', remember: true });
  assert.throws(() => parseCredentialArguments(credentialChannels.setRemember, [true]));
  assert.throws(() => parseCredentialArguments(credentialChannels.setRemember, ['other', true]));
  assert.deepEqual(parseCredentialArguments(credentialChannels.getStatus, []), undefined);
  assert.throws(() => parseCredentialArguments(credentialChannels.setRemember, ['true']));
  assert.throws(() => parseCredentialArguments(credentialChannels.clear, ['extra']));
});

test('SQLite 只保存密文，并支持保存/读取/删除/关闭记住', async () => {
  const { directory, file, vault } = await temporaryVault();
  try {
    const initial = await vault.status();
    assert.equal(initial.available, true); assert.equal(initial.remembered, false); assert.deepEqual(initial.savedProviders, []);
    await rememberBoth(vault, true);
    await Promise.all([vault.save(neteaseBundle), vault.save(kugouBundle)]);
    const status = await vault.status();
    assert.deepEqual(status.savedProviders, ['netease', 'kugou']);
    const content = (await readFile(file)).toString('latin1');
    assert.ok(!content.includes('synthetic-token'));
    assert.ok(!content.includes('synthetic-music-u'));
    assert.deepEqual(await vault.load('netease'), neteaseBundle);
    assert.deepEqual(await vault.load('kugou'), kugouBundle);
    if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);
    await vault.remove('netease');
    assert.equal(await vault.load('netease'), undefined);
    assert.deepEqual((await vault.status()).savedProviders, ['kugou']);
    await rememberBoth(vault, false);
    assert.equal(await vault.load('kugou'), undefined);
    const closed = await vault.status();
    assert.equal(closed.remembered, false); assert.deepEqual(closed.savedProviders, []);
  } finally { await cleanup(directory); }
});

test('加密后端不可用时不写入凭据，也不假装启用记住登录', async () => {
  const cipher = new FakeCipher(false); const { directory, file, vault } = await temporaryVault(cipher);
  try {
    const status = await vault.status();
    assert.equal(status.available, false); assert.equal(status.backend, 'fake-keyring');
    await assert.rejects(rememberBoth(vault, true), (error: unknown) => error instanceof DomainError && error.code === 'credential-unavailable');
    assert.equal(await vault.save(neteaseBundle), false);
    assert.equal(await vault.load('netease'), undefined);
    assert.equal(await openStore(file).read(), undefined);
  } finally { await cleanup(directory); }
});

test('密文损坏或解密失败进入锁定状态，清除后恢复可用', async () => {
  const { directory, file, vault } = await temporaryVault();
  try {
    await rememberBoth(vault, true); await vault.save(neteaseBundle);
    const database = new DatabaseSync(file);
    database.prepare('UPDATE credentials SET ciphertext = ? WHERE provider = ?').run(Buffer.from('tampered').toString('base64'), 'netease');
    database.close();
    const reopened = new CredentialVault(openStore(file), new FakeCipher(), () => 2000);
    await assert.rejects(reopened.load('netease'), (error: unknown) => error instanceof DomainError && error.code === 'credential-locked');
    const locked = await reopened.status();
    assert.equal(locked.locked, true); assert.equal(locked.available, false);
    const cleared = await reopened.clear();
    assert.equal(cleared.locked, false); assert.equal(cleared.remembered, false);
    assert.equal((await reopened.status()).available, true);
  } finally { await cleanup(directory); }
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
      await rememberBoth(vault, true);
      const pending = vault.save(kugouBundle);
      await new Promise<void>(done => setImmediate(done));
      if (mode === 'logout') await vault.remove('kugou');
      else if (mode === 'clear') await vault.clear();
      else { await rememberBoth(vault, false); await rememberBoth(vault, true); }
      release();
      assert.equal(await pending, false);
      assert.deepEqual((await vault.status()).savedProviders, []);
      assert.equal(await vault.load('kugou'), undefined);
    } finally { release(); await cleanup(directory); }
  }
});

test('重建保险库仍能恢复双平台密文保存项，各平台独立删除', async () => {
  const { directory, file, vault } = await temporaryVault();
  try {
    await rememberBoth(vault, true); await vault.save(neteaseBundle); await vault.save(kugouBundle);
    const restarted = new CredentialVault(openStore(file), new FakeCipher());
    assert.equal((await restarted.status()).remembered, true);
    assert.deepEqual(await restarted.load('netease'), neteaseBundle);
    assert.deepEqual(await restarted.load('kugou'), kugouBundle);
    await restarted.remove('kugou');
    assert.deepEqual(await restarted.load('netease'), neteaseBundle);
    assert.equal(await restarted.load('kugou'), undefined);
  } finally { await cleanup(directory); }
});

test('本地随机密钥 + SQLite 在不依赖系统服务的情况下加密并跨实例恢复双平台', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'starsmusic-local-vault-'));
  const file = path.join(directory, 'credentials.sqlite'); const key = path.join(directory, 'keys', 'login.key');
  const store = openStore(file); const cipher = new LocalKeyCipher(key, async () => Object.keys((await store.read())?.entries ?? {}).length > 0);
  const vault = new CredentialVault(store, cipher);
  try {
    assert.equal((await vault.status()).available, true);
    await assert.rejects(stat(key)); // 默认关闭时不生成密钥/保存平台凭据。
    await rememberBoth(vault, true); await Promise.all([vault.save(neteaseBundle), vault.save(kugouBundle)]);
    const first = (await store.read())!.entries.netease!.ciphertext;
    await vault.save(neteaseBundle);
    assert.notEqual((await store.read())!.entries.netease!.ciphertext, first); // 每次随机 nonce。
    const raw = (await readFile(file)).toString('latin1');
    for (const secret of ['synthetic-music-u', 'synthetic-token', '合成账号', 'synthetic-device']) assert.equal(raw.includes(secret), false);
    assert.equal((await readFile(key)).length, 32);
    if (process.platform !== 'win32') {
      assert.equal((await stat(key)).mode & 0o777, 0o600);
      assert.equal((await stat(path.dirname(key))).mode & 0o777, 0o700);
      assert.equal((await stat(file)).mode & 0o777, 0o600);
    }
    await vault.close();
    const reopened = openStore(file);
    const restarted = new CredentialVault(reopened, new LocalKeyCipher(key, async () => Object.keys((await reopened.read())?.entries ?? {}).length > 0));
    assert.equal((await restarted.status()).remembered, true);
    assert.deepEqual(await restarted.load('netease'), neteaseBundle);
    assert.deepEqual(await restarted.load('kugou'), kugouBundle);
    await restarted.remove('kugou'); assert.equal(await restarted.load('kugou'), undefined);
    assert.deepEqual(await restarted.load('netease'), neteaseBundle);
    await restarted.clear(); await assert.rejects(stat(key));
    assert.deepEqual((await restarted.status()).savedProviders, []);
  } finally { await cleanup(directory); }
});

test('本地密钥丢失不自动替换，错误密钥/被篡改密文不能解密，明确清除后可重新保存', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'starsmusic-local-vault-'));
  const file = path.join(directory, 'credentials.sqlite'); const key = path.join(directory, 'keys', 'login.key');
  const openVault = () => {
    const store = openStore(file);
    return new CredentialVault(store, new LocalKeyCipher(key, async () => Object.keys((await store.read())?.entries ?? {}).length > 0));
  };
  try {
    const original = openVault(); await rememberBoth(original, true); await original.save(kugouBundle); await original.close();
    const savedKey = await readFile(key); await rm(key);
    const missing = openVault();
    assert.equal((await missing.status()).available, false);
    await assert.rejects(missing.load('kugou')); await assert.rejects(rememberBoth(missing, true));
    await assert.rejects(stat(key)); await missing.close();
    await writeFile(key, Buffer.alloc(32, 1), { mode: 0o600 });
    const wrong = openVault();
    await assert.rejects(wrong.load('kugou'));
    assert.equal((await wrong.status()).locked, true);
    await wrong.clear(); await rememberBoth(wrong, true); await wrong.save(kugouBundle);
    assert.deepEqual(await wrong.load('kugou'), kugouBundle);
    assert.notDeepEqual(await readFile(key), savedKey);
    const database = new DatabaseSync(file);
    database.exec("UPDATE credentials SET ciphertext = 'v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'"); database.close();
    const tampered = openVault(); await assert.rejects(tampered.load('kugou')); assert.equal((await tampered.status()).locked, true);
  } finally { await cleanup(directory); }
});

test('SQLite 拒绝未知版本、损坏库并保留文件，用户明确清除后重建', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'starsmusic-local-vault-')); const file = path.join(directory, 'credentials.sqlite');
  try {
    const initial = openStore(file); await initial.write({ version: 1, remember: false, entries: {} }); await initial.close();
    const database = new DatabaseSync(file); database.exec('PRAGMA user_version=99'); database.close();
    const before = await readFile(file); const store = openStore(file); const vault = new CredentialVault(store, new FakeCipher());
    assert.equal((await vault.status()).locked, true);
    assert.deepEqual(await readFile(file), before);
    await vault.clear(); assert.equal((await vault.status()).available, true);
    await vault.close(); await writeFile(file, 'synthetic corrupted database');
    const corrupt = new CredentialVault(openStore(file), new FakeCipher()); assert.equal((await corrupt.status()).locked, true);
    await corrupt.clear(); assert.equal((await corrupt.status()).locked, false);
  } finally { await cleanup(directory); }
});

test('旧系统密钥文件只在新库未初始化时导入，成功提交才删除旧文件，不可解密时保留', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'starsmusic-local-vault-'));
  const file = path.join(directory, 'credentials.sqlite'); const legacyFile = path.join(directory, 'credentials.json');
  const store = openStore(file); const oldCipher = new FakeCipher();
  const cipher = new LocalKeyCipher(path.join(directory, 'keys', 'login.key'), async () => Object.keys((await store.read())?.entries ?? {}).length > 0);
  const legacy = { version: 1, remember: true, entries: { kugou: { ciphertext: await oldCipher.encrypt(JSON.stringify(kugouBundle)), updatedAt: 1000 } } };
  try {
    await writeFile(legacyFile, JSON.stringify(legacy), { mode: 0o600 });
    await migrateLegacyCredentials(store, cipher, new FakeCipher(false), legacyFile);
    assert.equal(await store.read(), undefined); assert.ok(await stat(legacyFile));
    await migrateLegacyCredentials(store, cipher, oldCipher, legacyFile);
    await assert.rejects(stat(legacyFile));
    const vault = new CredentialVault(store, cipher); assert.deepEqual(await vault.load('kugou'), kugouBundle);
    await vault.clear();
    await writeFile(legacyFile, JSON.stringify(legacy), { mode: 0o600 });
    await migrateLegacyCredentials(store, cipher, oldCipher, legacyFile);
    assert.deepEqual((await store.read())?.entries, {}); assert.ok(await stat(legacyFile));
  } finally { await cleanup(directory); }
});

test('SQLite 事务写入失败时保留此前双平台保存项与记住设置', async () => {
  const { directory, file, vault } = await temporaryVault();
  try {
    await rememberBoth(vault, true); await vault.save(neteaseBundle); await vault.save(kugouBundle);
    const before = await openStore(file).read();
    const database = new DatabaseSync(file);
    database.exec("CREATE TRIGGER synthetic_abort BEFORE INSERT ON credentials BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END");
    database.close();
    await assert.rejects(vault.remove('kugou'));
    assert.deepEqual(await openStore(file).read(), before);
  } finally { await cleanup(directory); }
});

test('扫码记住选择仅影响对应平台，未勾选的平台不保存，退出删除后下次重新选择', async () => {
  const { directory, file, vault } = await temporaryVault();
  try {
    await vault.setRemember('kugou', true);
    assert.equal(await vault.save(neteaseBundle), false);
    assert.equal(await vault.save(kugouBundle), true);
    assert.deepEqual((await vault.status()).rememberedProviders, ['kugou']);
    const restarted = new CredentialVault(openStore(file), new FakeCipher());
    assert.deepEqual((await restarted.status()).rememberedProviders, ['kugou']);
    assert.deepEqual(await restarted.load('kugou'), kugouBundle);
    await restarted.remove('kugou');
    assert.deepEqual((await restarted.status()).rememberedProviders, []);
    assert.equal(await restarted.save(kugouBundle), false);
    await restarted.setRemember('netease', true); await restarted.save(neteaseBundle);
    await restarted.setRemember('kugou', true); await restarted.save(kugouBundle);
    await restarted.setRemember('kugou', false);
    assert.deepEqual(await restarted.load('netease'), neteaseBundle);
    assert.equal(await restarted.load('kugou'), undefined);
  } finally { await cleanup(directory); }
});

test('扫码未完成时的勾选不带到下次启动，另一个平台退出不撤销当前平台的保存', async () => {
  const { directory, file, vault } = await temporaryVault();
  try {
    await vault.setRemember('kugou', true);
    const restarted = new CredentialVault(openStore(file), new FakeCipher());
    assert.deepEqual((await restarted.status()).rememberedProviders, []);
    await vault.setRemember('netease', true); await vault.save(neteaseBundle);
    await vault.remove('kugou');
    assert.deepEqual((await vault.status()).rememberedProviders, ['netease']);
    assert.deepEqual(await vault.load('netease'), neteaseBundle);
    assert.equal(await vault.save(kugouBundle), false);
    const first = await vault.status(); const second = await vault.status();
    assert.ok(second.revision > first.revision);
  } finally { await cleanup(directory); }
});

test('等候存储可用性时退出或清除，迟到的勾选不会重新启用保存', async () => {
  for (const mode of ['logout', 'clear'] as const) {
    const cipher = new FakeCipher(); const { directory, vault } = await temporaryVault(cipher);
    let release!: () => void;
    const barrier = new Promise<void>(done => { release = done; }); let first = true;
    cipher.available = async () => { if (first) { first = false; await barrier; } return true; };
    try {
      const pending = vault.setRemember('kugou', true);
      await new Promise<void>(done => setImmediate(done));
      // SQLite 初次打开是异步操作，等到延迟的可用性检查实际开始。
      while (first) await new Promise<void>(done => setImmediate(done));
      if (mode === 'logout') await vault.remove('kugou'); else await vault.clear();
      release(); await pending;
      assert.deepEqual((await vault.status()).rememberedProviders, []);
      assert.equal(await vault.save(kugouBundle), false);
    } finally { release(); await cleanup(directory); }
  }
});
