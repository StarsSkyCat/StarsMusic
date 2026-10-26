import assert from 'node:assert/strict';
import test from 'node:test';
import { initialKugouSnapshot, kugouChannels, parseKugouArguments, parseKugouSnapshot } from '../../packages/contracts/src/kugou.ts';
import { KugouService, parseKugouStream } from '../../packages/providers/src/kugou/service.ts';
import { DirectKugouTransport, type KugouEndpoint, type KugouTransport } from '../../packages/providers/src/kugou/transport.ts';
import { DomainError } from '../../packages/contracts/src/errors.ts';

// 全部为合成数据，不连接平台，不使用真实凭据/登录二维码。
const hash = 'a'.repeat(32);
const png = 'data:image/png;base64,c3ludGhldGlj';
const ok = (data: unknown) => ({ status: 1, error_code: 0, data });
const stream = { status: 1, hash, url: ['https://fsandroid.kugou.com/synthetic'], priv_status: 0, bitRate: 128000, extName: 'mp3' };
class FakeTransport implements KugouTransport {
  cleared = false;
  pollStatus = 4;
  account = '42';
  profileAccount = '42';
  handlers = new Map<KugouEndpoint, (data: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>>();
  acceptIdentity(userid: string, token: string): void { assert.equal(userid, this.account); assert.equal(token, 'synthetic-private-marker'); }
  clear(): void { this.cleared = true; }
  async call(endpoint: KugouEndpoint, data: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    const handler = this.handlers.get(endpoint); if (handler) return handler(data, signal);
    if (endpoint === 'register') return ok({});
    if (endpoint === 'qrKey') return ok({ qrcode: 'synthetic-key' });
    if (endpoint === 'qrPoll') return ok({ status: this.pollStatus, userid: this.account, token: 'synthetic-private-marker' });
    if (endpoint === 'account') return ok({ userid: this.profileAccount, nickname: '合成账号' });
    if (endpoint === 'playlists') return ok({ info: [{ listid: 1, name: '合成歌单', count: 1 }] });
    if (endpoint === 'playlist') return ok({ count: 1, info: [{ hash, name: '合成曲目', singerinfo: [{ name: '合成歌手' }], duration: 30, audio_id: 2, album_audio_id: 0 }] });
    return stream;
  }
}
const create = (factory: () => FakeTransport, now = () => 1000) => new KugouService({ transport: factory, encodeQr: async () => png, autoPoll: false, now });
async function connect(service: KugouService) { await service.startLogin(); await service.pollOnce(); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }

test('酷狗具体 IPC 校验，快照不公开凭据且退出丢弃私人数据', () => {
  for (const [channel, args] of [[kugouChannels.startLogin, ['extra']], [kugouChannels.playTrack, ['https://example.invalid/']], [kugouChannels.loadPlaylist, ['1', 5]], ['request', []]] as const) {
    assert.throws(() => parseKugouArguments(channel, args));
  }
  const initial = initialKugouSnapshot();
  assert.deepEqual(parseKugouSnapshot({ ...initial, token: 'synthetic-private-marker', account: { id: '42' }, tracks: [{ invalid: true }] }), initial);
  assert.throws(() => parseKugouSnapshot({ ...initial, status: 'waiting-scan', qrImage: 'https://example.invalid/', expiresAt: 100 }));
});

test('标准版扫码需账号验证一致后连接，歌单/曲目登记及退出清理', async () => {
  const transport = new FakeTransport(); const service = create(() => transport);
  try {
    await service.startLogin(); transport.pollStatus = 1; assert.equal((await service.pollOnce()).status, 'waiting-scan');
    transport.pollStatus = 2; assert.equal((await service.pollOnce()).status, 'awaiting-confirmation');
    transport.pollStatus = 4; await service.pollOnce(); assert.equal(service.snapshot().status, 'connected');
    await service.loadPlaylists(); await service.loadPlaylist('1', 0);
    assert.equal(service.snapshot().tracks[0]?.id, hash);
    assert.ok(!JSON.stringify(service.snapshot()).includes('synthetic-private-marker'));
    transport.handlers.set('stream', async (data) => { assert.equal(data.hash, hash); return stream; });
    assert.equal((await service.resolveTrack(hash, service.snapshot().generation)).track.provider, 'kugou');
    await assert.rejects(service.resolveTrack('b'.repeat(32), service.snapshot().generation));
    await assert.rejects(service.resolveTrack(hash, service.snapshot().generation - 1));
    service.logout(); assert.equal(transport.cleared, true); assert.deepEqual(service.snapshot().tracks, []);
    await assert.rejects(service.resolveTrack(hash, 0));
  } finally { service.dispose(); }
});

test('完整资源无权限时回退到试听，文件名不匹配则拒绝', async () => {
  const transport = new FakeTransport(); const service = create(() => transport);
  try {
    await connect(service); await service.loadPlaylists(); await service.loadPlaylist('1', 0);
    let calls = 0;
    transport.handlers.set('stream', async (data) => {
      calls += 1;
      if (data.freePart !== true) throw new DomainError('permission-denied');
      return { ...stream, hash: 'b'.repeat(32), timeLength: 254, fileName: '合成歌手 - 合成曲目.mp3' };
    });
    const preview = await service.resolveTrack(hash, service.snapshot().generation);
    assert.deepEqual(preview.access, { kind: 'preview', startMs: 0, durationMs: 254000 });
    assert.equal(calls, 2); assert.equal(service.snapshot().error, undefined);
    transport.handlers.set('stream', async () => ({ ...stream, hash: 'b'.repeat(32), timeLength: 254, fileName: '另一首歌.mp3' }));
    await assert.rejects(service.resolveTrack(hash, service.snapshot().generation), (error: unknown) => error instanceof DomainError && error.code === 'track-mismatch');
    assert.equal(service.snapshot().error?.code, 'track-mismatch');
  } finally { service.dispose(); }
});

test('取消后的迟到二维码和账号响应不能覆盖新会话', async () => {
  const old = new FakeTransport(); const next = new FakeTransport(); let count = 0;
  const qr = deferred<unknown>(); old.handlers.set('qrKey', async () => qr.promise);
  const service = create(() => count++ === 0 ? old : next);
  try {
    const pending = service.startLogin(); await new Promise<void>((done) => setImmediate(done));
    service.cancelLogin(); await service.startLogin(); const generation = service.snapshot().generation;
    qr.resolve(ok({ qrcode: 'old-key' })); await pending; assert.equal(service.snapshot().generation, generation);
    const account = deferred<unknown>(); next.handlers.set('account', async () => account.promise);
    const verify = service.pollOnce(); await new Promise<void>((done) => setImmediate(done));
    service.logout(); await service.startLogin(); account.resolve(ok({ userid: '42', nickname: '旧账号' })); await verify;
    assert.equal(service.snapshot().status, 'waiting-scan'); assert.equal(service.snapshot().account, undefined);
  } finally { service.dispose(); }
});

test('旧账号歌单、旧歌单详情和迟到的错误都不能覆盖当前页面', async () => {
  const transport = new FakeTransport(); const service = create(() => transport);
  try {
    await connect(service); const lists = deferred<unknown>(); transport.handlers.set('playlists', async () => lists.promise);
    const pending = service.loadPlaylists(); service.logout(); await connect(service);
    lists.resolve(ok({ info: [{ listid: 9, name: '旧歌单', count: 1 }] })); await pending;
    assert.deepEqual(service.snapshot().playlists, []);
    transport.handlers.set('playlists', async () => ok({ info: [{ listid: 1, name: 'A', count: 1 }, { listid: 2, name: 'B', count: 1 }] }));
    await service.loadPlaylists(); const detail = deferred<unknown>();
    transport.handlers.set('playlist', async (data) => data.id === '1' ? detail.promise : ok({ count: 0, info: [] }));
    const old = service.loadPlaylist('1', 0); await service.loadPlaylist('2', 0); detail.resolve({ status: 0 }); await old;
    assert.equal(service.snapshot().playlistId, '2'); assert.equal(service.snapshot().error, undefined);
  } finally { service.dispose(); }
});

test('不匹配账号、二维码过期、安全验证均不冒充登录成功', async () => {
  let now = 1000; const transport = new FakeTransport(); const service = create(() => transport, () => now);
  try {
    transport.profileAccount = '43'; await connect(service); assert.equal(service.snapshot().status, 'failed');
    assert.equal(transport.cleared, true); await service.startLogin(); now += 180001;
    assert.equal((await service.pollOnce()).status, 'expired');
    transport.handlers.set('register', async () => { throw new DomainError('verification-required'); });
    assert.equal((await service.startLogin()).error?.code, 'verification-required');
  } finally { service.dispose(); }
});

test('受保护账号接口成功但不回显 ID 时仍验证昵称；回显不一致或空资料必须拒绝', async () => {
  const transport = new FakeTransport(); const service = create(() => transport);
  try {
    transport.handlers.set('account', async () => ok({ nickname: '合成账号' }));
    await connect(service); assert.equal(service.snapshot().status, 'connected'); assert.equal(service.snapshot().account?.id, '42');
    transport.handlers.set('account', async () => ok({ userid: '43', nickname: '其他账号' }));
    await connect(service); assert.equal(service.snapshot().loginDiagnostic, 'profile-mismatch');
    transport.handlers.set('account', async () => ok({}));
    await connect(service); assert.equal(service.snapshot().status, 'failed'); assert.equal(service.snapshot().loginDiagnostic, 'profile-nickname');
    transport.handlers.set('account', async () => ({ status: 0, error_code: 20018 }));
    await connect(service); assert.equal(service.snapshot().status, 'failed');
  } finally { service.dispose(); }
});

test('酷狗歌单兼容缺总数、字符串时长、损坏单条和超过 50 条的有效曲目', async () => {
  const transport = new FakeTransport(); const service = create(() => transport);
  try {
    await connect(service); await service.loadPlaylists();
    const rows: Record<string, unknown>[] = Array.from({ length: 300 }, (_, index) => ({
      hash: index.toString(16).padStart(32, '0'), name: `合成曲目 ${index}`,
      singerinfo: [{ name: '合成歌手' }], timelen: '30000', album_id: 1, audio_id: 2,
    }));
    rows.push({ invalid: true });
    transport.handlers.set('playlist', async () => ok({ info: rows }));
    await service.loadPlaylist('1', 0);
    assert.equal(service.snapshot().tracks.length, 300);
    assert.equal(service.snapshot().tracks[0]?.durationMs, 30000);
    assert.equal(service.snapshot().tracksMore, true);
    assert.equal(service.snapshot().nextTrackOffset, 300);
    assert.deepEqual(parseKugouArguments(kugouChannels.loadPlaylist, ['1', 300]), { id: '1', offset: 300 });
    assert.throws(() => parseKugouArguments(kugouChannels.loadPlaylist, ['1', 50]));
  } finally { service.dispose(); }
});

test('流只接受明确权限、HTTPS 官方媒体主机，响应缺少试听边界时拒绝', () => {
  assert.equal(parseKugouStream(stream, hash).quality.bitrateKbps, 128);
  assert.equal(parseKugouStream({ ...stream, priv_status: 1, free_part_start: 0, free_part_end: 30000 }, hash).access.kind, 'preview');
  const stringPreview = parseKugouStream({ ...stream, priv_status: '1', free_part_start: '0', free_part_end: '30000', bitRate: '320000' }, hash);
  assert.deepEqual(stringPreview.access, { kind: 'preview', startMs: 0, durationMs: 30000 });
  assert.equal(stringPreview.quality.bitrateKbps, 320);
  assert.equal(parseKugouStream({ ...stream, priv_status: '0' }, hash).access.kind, 'full');
  assert.equal(parseKugouStream({ ...stream, priv_status: 1, is_full_audio: 1 }, hash).access.kind, 'full');
  assert.equal(parseKugouStream({ ...stream, priv_status: '1', is_full_audio: '1' }, hash).access.kind, 'full');
  assert.throws(() => parseKugouStream({ ...stream, priv_status: 1, is_full_audio: 0 }, hash));
  assert.throws(() => parseKugouStream({ ...stream, hash: 'b'.repeat(32) }, hash), (error: unknown) => error instanceof DomainError && error.code === 'track-mismatch');
  assert.throws(() => parseKugouStream({ ...stream, hash: 'b'.repeat(32), std_hash: 'c'.repeat(32) }, hash), (error: unknown) => error instanceof DomainError && error.code === 'track-mismatch');
  assert.equal(parseKugouStream({ ...stream, hash: 'b'.repeat(32), std_hash: hash }, hash).track.id, hash);
  assert.equal(parseKugouStream({ ...stream, hash: 'b'.repeat(32), timeLength: 30 }, hash, { name: '合成曲目', durationMs: 30000 }).track.id, hash);
  assert.throws(() => parseKugouStream({ ...stream, hash: 'b'.repeat(32), timeLength: 60 }, hash, { name: '合成曲目', durationMs: 30000 }), (error: unknown) => error instanceof DomainError && error.code === 'track-mismatch');
  assert.equal(parseKugouStream({ ...stream, hash: hash.toUpperCase() }, hash).track.id, hash);
  const preview = parseKugouStream({ ...stream, hash: 'b'.repeat(32), timeLength: 254, fileName: '合成歌手 - 合成曲目.mp3' }, hash, { name: '合成曲目', durationMs: 207000 }, 'preview');
  assert.deepEqual(preview.access, { kind: 'preview', startMs: 0, durationMs: 254000 });
  assert.throws(() => parseKugouStream({ ...stream, hash: 'b'.repeat(32), fileName: '另一首歌.mp3' }, hash, { name: '合成曲目', durationMs: 207000 }, 'preview'), (error: unknown) => error instanceof DomainError && error.code === 'track-mismatch');
  assert.throws(() => parseKugouStream({ ...stream, hash: 'b'.repeat(32) }, hash, { name: '合成曲目', durationMs: 207000 }, 'preview'), (error: unknown) => error instanceof DomainError && error.code === 'track-mismatch');
  assert.throws(() => parseKugouStream({ ...stream, priv_status: 1 }, hash));
  assert.throws(() => parseKugouStream({ ...stream, url: ['https://www.kugou.com/private'] }, hash));
  assert.throws(() => parseKugouStream({ ...stream, url: ['https://fsandroid.kugou.com.evil.invalid/audio'] }, hash));
  assert.throws(() => parseKugouStream({ ...stream, url: [] }, hash));
});

test('真实 transport 固定 App 1005 渠道、拒绝重定向与安全验证，不泄漏原始异常', async () => {
  const original = globalThis.fetch; const transport = new DirectKugouTransport();
  try {
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.hostname, 'login-user.kugou.com'); assert.equal(init?.redirect, 'error');
      assert.equal(url.searchParams.get('appid'), '1005'); assert.equal(url.searchParams.has('token'), true);
      assert.match(url.searchParams.get('mid') ?? '', /^\d{20,40}$/);
      assert.ok(!String(init?.headers).includes('netease'));
      return new Response('{}', { headers: { 'ssa-code': 'synthetic' } });
    };
    transport.acceptIdentity('42', 'synthetic-private-marker');
    await assert.rejects(transport.call('qrPoll', { key: 'synthetic' }, new AbortController().signal), (e: unknown) => e instanceof DomainError && e.code === 'verification-required');
    globalThis.fetch = async () => { throw new Error('synthetic-private-marker'); };
    await assert.rejects(transport.call('qrPoll', { key: 'synthetic' }, new AbortController().signal), (e: unknown) => e instanceof DomainError && e.code === 'network' && !e.message.includes('synthetic-private-marker'));
    transport.clear();
    globalThis.fetch = async (input) => {
      assert.equal(new URL(String(input)).searchParams.has('token'), false);
      return new Response(JSON.stringify(ok({ status: 1 })));
    };
    await transport.call('qrPoll', { key: 'synthetic' }, new AbortController().signal);
    transport.acceptIdentity('42', 'synthetic-private-marker');
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      assert.equal(url.hostname, 'gateway.kugou.com');
      assert.equal(url.searchParams.get('hash'), 'a'.repeat(32));
      assert.equal(url.searchParams.get('album_id'), '0');
      assert.equal(url.searchParams.get('album_audio_id'), '0');
      assert.equal(url.searchParams.get('quality'), '128');
      assert.equal(url.searchParams.get('clientver'), '11430');
      assert.equal(url.searchParams.get('IsFreePart'), '0');
      assert.match(url.searchParams.get('key') ?? '', /^[a-f0-9]{32}$/);
      return new Response(JSON.stringify(ok({})));
    };
    await transport.call('stream', { hash: 'a'.repeat(32) }, new AbortController().signal);
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      assert.equal(url.searchParams.get('IsFreePart'), '1');
      return new Response(JSON.stringify(ok({})));
    };
    await transport.call('stream', { hash: 'a'.repeat(32), freePart: true }, new AbortController().signal);
  } finally { transport.clear(); globalThis.fetch = original; }
});
