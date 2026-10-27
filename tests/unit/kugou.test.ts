import assert from 'node:assert/strict';
import test from 'node:test';
import { initialKugouSnapshot, kugouChannels, parseKugouArguments, parseKugouSnapshot } from '../../packages/contracts/src/kugou.ts';
import { KugouService, parseKugouStream, parseKugouResourceIdentity } from '../../packages/providers/src/kugou/service.ts';
import { DirectKugouTransport, type KugouEndpoint, type KugouTransport, type KugouTransportSession } from '../../packages/providers/src/kugou/transport.ts';
import { DomainError } from '../../packages/contracts/src/errors.ts';
import type { KugouCredentialBundle } from '../../packages/contracts/src/credentials.ts';

// 全部为合成数据，不连接平台，不使用真实凭据/登录二维码。
const hash = 'a'.repeat(32);
const png = 'data:image/png;base64,c3ludGhldGlj';
const ok = (data: unknown) => ({ status: 1, error_code: 0, data });
const stream = { status: 1, hash, url: ['https://fsandroid.kugou.com/synthetic'], priv_status: 0, bitRate: 128000, extName: 'mp3' };
class FakeTransport implements KugouTransport {
  cleared = false;
  authenticated = false;
  session: KugouTransportSession | undefined;
  pollStatus = 4;
  account = '42';
  profileAccount = '42';
  handlers = new Map<KugouEndpoint, (data: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>>();
  acceptIdentity(userid: string, token: string): void { assert.equal(userid, this.account); assert.equal(token, 'synthetic-private-marker'); this.authenticated = true; }
  exportSession(): KugouTransportSession | undefined {
    return this.authenticated ? this.session ?? { userid: this.account, token: 'synthetic-private-marker', dfid: 'synthetic-dfid', guid: '00000000-0000-4000-8000-000000000000' } : undefined;
  }
  restoreSession(session: KugouTransportSession): void { this.session = session; this.authenticated = true; }
  clear(): void { this.cleared = true; this.authenticated = false; this.session = undefined; }
  async call(endpoint: KugouEndpoint, data: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    const handler = this.handlers.get(endpoint); if (handler) return handler(data, signal);
    if (endpoint === 'register') return ok({});
    if (endpoint === 'qrKey') return ok({ qrcode: 'synthetic-key' });
    if (endpoint === 'qrPoll') return ok({ status: this.pollStatus, userid: this.account, token: 'synthetic-private-marker' });
    if (endpoint === 'account') return ok({ userid: this.profileAccount, nickname: '合成账号' });
    if (endpoint === 'playlists') return ok({ info: [{ listid: 1, name: '合成歌单', count: 1 }] });
    if (endpoint === 'resource') return ok([{ hash: data.hash, name: '合成歌手 - 合成曲目', relate_goods: [{ hash: data.hash, quality: '128' }] }]);
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
      return { ...stream, hash: 'b'.repeat(32), timeLength: 254, fileName: '合成歌手 - 合成曲目.mp3', free_part_start: 60000, free_part_end: 90000 };
    });
    const preview = await service.resolveTrack(hash, service.snapshot().generation);
    assert.deepEqual(preview.access, { kind: 'preview', startMs: 0, durationMs: 30000 });
    assert.equal(calls, 2); assert.equal(service.snapshot().error, undefined);
    transport.handlers.set('stream', async () => ({ ...stream, hash: 'b'.repeat(32), timeLength: 254, fileName: '另一首歌.mp3' }));
    await assert.rejects(service.resolveTrack(hash, service.snapshot().generation), (error: unknown) => error instanceof DomainError && error.code === 'track-mismatch');
    assert.equal(service.snapshot().error?.code, 'track-mismatch');
  } finally { service.dispose(); }
});

test('酷狗成功登录可导出凭据并从凭据恢复', async () => {
  let emitted: KugouCredentialBundle | undefined;
  const transport = new FakeTransport();
  const instance = new KugouService({ transport: () => transport, encodeQr: async () => png, autoPoll: false, now: () => 1000, onCredentials: (bundle) => { emitted = bundle; } });
  try {
    await connect(instance);
    assert.equal(emitted?.provider, 'kugou');
    const bundle = instance.exportCredentials();
    assert.ok(bundle);
    assert.equal(bundle.dfid, 'synthetic-dfid');
    const restoredTransport = new FakeTransport();
    const restored = new KugouService({ transport: () => restoredTransport, encodeQr: async () => png, autoPoll: false, now: () => 1000 });
    try {
      const snapshot = await restored.restoreCredentials(bundle);
      assert.equal(snapshot.status, 'connected');
      assert.equal(snapshot.account?.id, '42');
      assert.equal(restoredTransport.authenticated, true);
    } finally { restored.dispose(); }
  } finally { instance.dispose(); }
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
  assert.throws(() => parseKugouStream({ ...stream, hash: 'b'.repeat(32), timeLength: 30 }, hash, { name: '合成曲目', durationMs: 30000 }), (e: unknown) => e instanceof DomainError && e.code === 'track-mismatch');
  assert.throws(() => parseKugouStream({ ...stream, hash: 'b'.repeat(32), timeLength: 60 }, hash, { name: '合成曲目', durationMs: 30000 }), (error: unknown) => error instanceof DomainError && error.code === 'track-mismatch');
  assert.equal(parseKugouStream({ ...stream, hash: hash.toUpperCase() }, hash).track.id, hash);
  const preview = parseKugouStream({ ...stream, hash: 'b'.repeat(32), timeLength: 254, fileName: '合成歌手 - 合成曲目.mp3', free_part_start: 60000, free_part_end: 90000 }, hash, { name: '合成曲目', durationMs: 207000, artists: ['合成歌手'] }, 'preview');
  assert.deepEqual(preview.access, { kind: 'preview', startMs: 0, durationMs: 30000 });
  assert.throws(() => parseKugouStream({ ...stream, hash: 'b'.repeat(32), fileName: '另一首歌.mp3' }, hash, { name: '合成曲目', durationMs: 207000, artists: ['合成歌手'] }, 'preview'), (error: unknown) => error instanceof DomainError && error.code === 'track-mismatch');
  assert.throws(() => parseKugouStream({ ...stream, hash: 'b'.repeat(32) }, hash, { name: '合成曲目', durationMs: 207000, artists: ['合成歌手'] }, 'preview'), (error: unknown) => error instanceof DomainError && error.code === 'track-mismatch');
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
    globalThis.fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.pagesize, 300);
      assert.equal(body.page, 2);
      assert.equal(body.listid, '1');
      return new Response(JSON.stringify(ok({ info: [] })));
    };
    await transport.call('playlist', { id: '1', type: 0, page: 2 }, new AbortController().signal);
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      const body = JSON.parse(String(init?.body));
      assert.equal(url.pathname, '/v2/get_res_privilege/lite');
      assert.equal(url.searchParams.get('token'), 'synthetic-private-marker');
      assert.equal(url.searchParams.get('appid'), '1005');
      assert.equal((init?.headers as Record<string, string>)['x-router'], 'media.store.kugou.com');
      assert.deepEqual(body.resource, [{ type: 'audio', page_id: 0, hash: 'a'.repeat(32), album_id: 0 }]);
      assert.deepEqual(body.qualities, ['128', '320', 'flac', 'high']);
      assert.equal(JSON.stringify(body).includes('album_audio_id'), false);
      return new Response(JSON.stringify(ok([])));
    };
    await transport.call('resource', { hash: 'A'.repeat(32) }, new AbortController().signal);
    await assert.rejects(transport.call('resource', { hash: 'https://arbitrary.invalid' }, new AbortController().signal));
  } finally { transport.clear(); globalThis.fetch = original; }
});


test('酷狗曲目按 300 条实际分页，第二页曲目的展示 ID 与取链 hash 不错位', async () => {
  const transport = new FakeTransport(); const service = create(() => transport);
  const hashOf = (n: number) => n.toString(16).padStart(32, '0');
  try {
    await connect(service); await service.loadPlaylists();
    const pages: unknown[] = [];
    transport.handlers.set('playlist', async (data) => {
      pages.push(data.page);
      const indexes = data.page === 1 ? Array.from({ length: 300 }, (_, i) => i) : [300];
      return ok({ count: 301, info: indexes.map(i => ({ hash: hashOf(i), name: `合成曲目 ${i}`, duration: 30 })) });
    });
    await service.loadPlaylist('1', 0);
    assert.equal(service.snapshot().tracks.length, 300);
    assert.equal(service.snapshot().tracksMore, true);
    await service.loadPlaylist('1', service.snapshot().nextTrackOffset);
    assert.deepEqual(pages, [1, 2]);
    assert.equal(service.snapshot().tracks.length, 301);
    assert.equal(service.snapshot().tracks[300]?.name, '合成曲目 300');
    assert.equal(service.snapshot().tracksMore, false);
    transport.handlers.set('stream', async data => {
      assert.equal(data.hash, hashOf(300));
      return { ...stream, hash: hashOf(300) };
    });
    assert.equal((await service.resolveTrack(hashOf(300), service.snapshot().generation)).track.id, hashOf(300));
  } finally { service.dispose(); }
});


test('酷狗会员/免费/试听权限以响应确认为准，不用资源时长制造无限试听', () => {
  const expected = { name: '合成曲目', durationMs: 254000 };
  const resource = { ...stream, timeLength: 254, fileName: '合成曲目' };
  const accessUnknown = (e: unknown) => e instanceof DomainError && e.code === 'playback-access-unknown';
  // 资源长 254 秒不意味着获得 254 秒试听权限。
  assert.throws(() => parseKugouStream(resource, hash, expected, 'preview'), accessUnknown);
  assert.throws(() => parseKugouStream({ ...resource, priv_status: 1 }, hash, expected), accessUnknown);
  assert.throws(() => parseKugouStream({ ...resource, priv_status: undefined }, hash, expected), accessUnknown);
  assert.throws(() => parseKugouStream({ ...resource, priv_status: 0, is_full_audio: false }, hash, expected), accessUnknown);
  assert.throws(() => parseKugouStream({ ...resource, is_full_audio: false }, hash, expected, 'preview'), accessUnknown);
  // 明确完整授权才可完整播放；从试听端点返回也如实投影，不冒充会员状态。
  assert.equal(parseKugouStream({ ...resource, priv_status: 1, is_full_audio: true }, hash, expected).access.kind, 'full');
  assert.equal(parseKugouStream({ ...resource, is_full_audio: '1' }, hash, expected, 'preview').access.kind, 'full');
  assert.equal(parseKugouStream(resource, hash, expected).access.kind, 'full');
  assert.equal(parseKugouStream({ ...resource, fileName: '合成歌手-合成曲目.mp3' }, hash, { ...expected, artists: ['合成歌手'] }).access.kind, 'full');
  assert.equal(parseKugouStream({ ...resource, timeLength: 200 }, hash, expected).access.kind, 'full'); // 不用云歌单旧时长否定明确匹配的 hash。
  assert.equal(parseKugouStream({ ...resource, free_part_start: 0, free_part_end: 30000 }, hash, expected).access.kind, 'preview');
  const partial = { ...resource, priv_status: 0, is_full_audio: '0', free_part_start: '60000', free_part_end: '90000' };
  assert.deepEqual(parseKugouStream(partial, hash, expected).access, { kind: 'preview', startMs: 0, durationMs: 30000 });
  assert.throws(() => parseKugouStream({ ...partial, free_part_end: 60000 }, hash, expected), accessUnknown);
});

test('相邻 A/B、同歌手不同曲、相同时长和缺失 hash 不会互相冒充', async () => {
  const expected = { name: '合成歌手 - 合成歌曲甲.mp3', durationMs: 30000 };
  const wrong = { ...stream, timeLength: 30, fileName: '合成歌手 - 合成歌曲乙.mp3' };
  const mismatch = (e: unknown) => e instanceof DomainError && e.code === 'track-mismatch';
  assert.throws(() => parseKugouStream(wrong, hash, expected), mismatch);
  assert.throws(() => parseKugouStream({ ...wrong, hash: 'b'.repeat(32) }, hash, expected, 'preview'), mismatch);
  assert.throws(() => parseKugouStream({ ...stream, hash: 'b'.repeat(32), fileName: '另一位歌手 - 合成曲目.mp3', free_part_start: 0, free_part_end: 30000 }, hash, { name: '合成曲目', durationMs: 30000, artists: ['合成歌手'] }, 'preview'), mismatch);
  assert.throws(() => parseKugouStream({ ...stream, hash: undefined }, hash, expected), mismatch);
  assert.throws(() => parseKugouStream({ ...stream, hash: 'b'.repeat(32), fileName: expected.name, timeLength: 30 }, hash, expected), mismatch);
  assert.equal(parseKugouStream({ ...stream, hash: 'b'.repeat(32), std_hash: hash, fileName: expected.name, timeLength: 30 }, hash, expected).track.id, hash);
  const transport = new FakeTransport(); const service = create(() => transport);
  try {
    await connect(service); await service.loadPlaylists(); await service.loadPlaylist('1', 0);
    let calls = 0;
    transport.handlers.set('stream', async () => { calls++; return { ...stream, fileName: '另一首曲目', timeLength: 30 }; });
    await assert.rejects(service.resolveTrack(hash, service.snapshot().generation), mismatch);
    assert.equal(calls, 1); // 身份冲突后不再借试听响应放宽校验。
  } finally { service.dispose(); }
});


test('酷狗切歌清除上一首资源错误，旧取链晚到不能覆盖新曲目状态', async () => {
  const transport = new FakeTransport(); const service = create(() => transport);
  const second = 'b'.repeat(32);
  try {
    await connect(service); await service.loadPlaylists();
    transport.handlers.set('playlist', async () => ok({ count: 2, info: [{ hash, name: '合成 A' }, { hash: second, name: '合成 B' }] }));
    await service.loadPlaylist('1', 0);
    transport.handlers.set('stream', async () => ({ status: 3 }));
    await assert.rejects(service.resolveTrack(hash, service.snapshot().generation));
    assert.equal(service.snapshot().error?.code, 'unavailable');
    transport.handlers.set('stream', async data => ({ ...stream, hash: data.hash }));
    await service.resolveTrack(second, service.snapshot().generation);
    assert.equal(service.snapshot().error, undefined);
    const old = deferred<unknown>();
    transport.handlers.set('stream', async data => data.hash === hash ? old.promise : { ...stream, hash: data.hash });
    const pending = service.resolveTrack(hash, service.snapshot().generation);
    await service.resolveTrack(second, service.snapshot().generation);
    old.resolve({ status: 3 });
    await assert.rejects(pending);
    assert.equal(service.snapshot().error, undefined);
  } finally { service.dispose(); }
});


test('酷狗编码关系按原始 hash 配对，不接受相邻资源、位置回退或其他歌曲', () => {
  const other = 'b'.repeat(32); const encoded = 'c'.repeat(32); const ogg = 'd'.repeat(32);
  const identity = parseKugouResourceIdentity(ok([
    { hash: other, name: '其他曲目', relate_goods: [{ hash: other }] },
    { hash: hash.toUpperCase(), name: '合成歌手 - 合成曲目', relate_goods: [{ hash: encoded, quality: '128' }], trans_param: { ogg_128_hash: ogg, unrelated_hash: other } },
  ]), hash);
  assert.deepEqual(identity.hashes, [hash, encoded, ogg]);
  assert.throws(() => parseKugouResourceIdentity(ok([{ hash: other, name: '合成曲目' }]), hash));
  assert.throws(() => parseKugouResourceIdentity(ok([{ hash, name: '一' }, { hash, name: '二' }]), hash));
  const response = { ...stream, hash: encoded, std_hash: encoded, fileName: '合成曲目' };
  const expected = { name: '合成歌手 - 合成曲目.mp3', durationMs: 30000, artists: ['合成歌手'] };
  assert.equal(parseKugouStream(response, hash, expected, 'full', identity).access.kind, 'full');
  assert.throws(() => parseKugouStream({ ...response, hash: other, std_hash: other }, hash, expected, 'full', identity));
  assert.throws(() => parseKugouStream(response, hash, { ...expected, name: '另一首曲目' }, 'full', identity));
  assert.throws(() => parseKugouStream({ ...response, priv_status: 1 }, hash, expected, 'preview', identity), (e: unknown) => e instanceof DomainError && e.code === 'playback-access-unknown');
});

test('云歌单保存高码率 hash 时，使用同账号的资源关系确认标准编码，不按名称或时长猜测', async () => {
  const transport = new FakeTransport(); const service = create(() => transport);
  const savedHash = 'b'.repeat(32); const calls: string[] = [];
  try {
    await connect(service); await service.loadPlaylists();
    transport.handlers.set('playlist', async () => ok({ count: 1, info: [{ hash: savedHash, name: '合成歌手 - 合成曲目.mp3', singerinfo: [{ name: '合成歌手' }], duration: 30 }] }));
    await service.loadPlaylist('1', 0);
    transport.handlers.set('stream', async data => {
      assert.equal(data.hash, savedHash); calls.push('stream');
      return { ...stream, fileName: '合成曲目' };
    });
    transport.handlers.set('resource', async data => {
      assert.equal(data.hash, savedHash); assert.equal(transport.authenticated, true); calls.push('resource');
      return ok([{ hash: savedHash, name: '合成歌手 - 合成曲目', relate_goods: [{ hash, quality: '128' }] }]);
    });
    const resolution = await service.resolveTrack(savedHash, service.snapshot().generation);
    assert.equal(resolution.track.id, savedHash); assert.equal(resolution.access.kind, 'full');
    assert.deepEqual(calls, ['stream', 'resource']);
    assert.equal(service.snapshot().error, undefined);
    transport.handlers.set('resource', async () => ok([{ hash: 'c'.repeat(32), name: '合成歌手 - 合成曲目', relate_goods: [{ hash }] }]));
    await assert.rejects(service.resolveTrack(savedHash, service.snapshot().generation), (e: unknown) => e instanceof DomainError && e.code === 'track-mismatch');
  } finally { service.dispose(); }
});

test('歌曲文件名的歌手别名差异不否定已确认 hash，但仍拒绝不同曲名', () => {
  const expected = { name: '合成艺名 - 合成曲目.mp3', durationMs: 30000, artists: ['合成艺名（合成本名）'] };
  assert.equal(parseKugouStream({ ...stream, fileName: '合成曲目' }, hash, expected).access.kind, 'full');
  assert.throws(() => parseKugouStream({ ...stream, fileName: '另一首曲目' }, hash, expected));
});


test('编码关系查询晚到时仍丢弃旧曲目，不覆盖新的播放结果', async () => {
  const transport = new FakeTransport(); const service = create(() => transport);
  const second = 'b'.repeat(32); const encoded = 'c'.repeat(32); const metadata = deferred<unknown>();
  try {
    await connect(service); await service.loadPlaylists();
    transport.handlers.set('playlist', async () => ok({ count: 2, info: [{ hash, name: '合成 A' }, { hash: second, name: '合成 B' }] }));
    await service.loadPlaylist('1', 0);
    transport.handlers.set('stream', async data => ({ ...stream, hash: data.hash === hash ? encoded : second }));
    transport.handlers.set('resource', async () => metadata.promise);
    const pending = service.resolveTrack(hash, service.snapshot().generation);
    await new Promise<void>(done => setImmediate(done));
    await service.resolveTrack(second, service.snapshot().generation);
    metadata.resolve(ok([{ hash, name: '合成 A', relate_goods: [{ hash: encoded }] }]));
    await assert.rejects(pending, (e: unknown) => e instanceof DomainError && e.code === 'stale-operation');
    assert.equal(service.snapshot().error, undefined);
  } finally { service.dispose(); }
});


test('酷狗展示去除末尾音频扩展名，保留曲名中间的点号并正常进行身份校验', async () => {
  const transport = new FakeTransport(); const service = create(() => transport);
  try {
    await connect(service); await service.loadPlaylists();
    transport.handlers.set('playlist', async () => ok({ count: 2, info: [
      { hash, name: '合成歌手 - 合成曲目.MP3', duration: 30 },
      { hash: 'b'.repeat(32), name: '合成.mp3 混音.flac', duration: 30 },
    ] }));
    await service.loadPlaylist('1', 0);
    assert.deepEqual(service.snapshot().tracks.map(t => t.name), ['合成歌手 - 合成曲目', '合成.mp3 混音']);
    transport.handlers.set('stream', async () => ({ ...stream, fileName: '合成歌手 - 合成曲目.mp3' }));
    assert.equal((await service.resolveTrack(hash, service.snapshot().generation)).access.kind, 'full');
  } finally { service.dispose(); }
});


test('酷狗歌词封面独立失败且不泄露原图地址，不影响播放状态', async () => {
  const transport = new FakeTransport(); let failArtwork = false;
  const instance = new KugouService({ transport: () => transport, encodeQr: async () => png, autoPoll: false,
    artwork: async (url, provider) => { assert.equal(provider, 'kugou'); assert.equal(url, 'https://imge.kugou.com/synthetic.jpg'); if (failArtwork) throw new DomainError('network'); return 'data:image/jpeg;base64,/9j/AQ=='; },
    lyricRequest: async endpoint => endpoint === 'search' ? { candidates: [{ id: '1', accesskey: 'synthetic-key', song: '合成曲目' }] } : { content: Buffer.from('[00:00]合成酷狗歌词').toString('base64') },
  });
  try {
    await connect(instance); await instance.loadPlaylists();
    transport.handlers.set('playlist', async () => ok({ count: 1, info: [{ hash, name: '合成曲目.mp3', cover: 'https://imge.kugou.com/synthetic.jpg', albuminfo: { name: '合成专辑' } }] }));
    await instance.loadPlaylist('1', 0);
    assert.equal(JSON.stringify(instance.snapshot()).includes('synthetic.jpg'), false);
    const ready = await instance.getPresentation(hash, instance.snapshot().generation);
    assert.equal(ready.album, '合成专辑'); assert.equal(ready.lyrics.length, 1); assert.match(ready.artwork!, /^data:image/);
    failArtwork = true;
    const partial = await instance.getPresentation(hash, instance.snapshot().generation);
    assert.equal(partial.lyrics.length, 1); assert.equal(partial.artwork, undefined); assert.equal(partial.artworkError?.code, 'network');
    assert.equal(instance.snapshot().error, undefined);
    await assert.rejects(instance.getPresentation('b'.repeat(32), instance.snapshot().generation));
  } finally { instance.dispose(); }
});

test('恢复酷狗 hash 元数据仅限原账号，仍按现有身份和权限校验取链', async () => {
  const transport = new FakeTransport(); const instance = create(() => transport);
  const track = { id: 'saved', title: '合成曲目', artist: '合成歌手', kind: 'kugou' as const, accountId: '42', sourceId: hash };
  try {
    await connect(instance); const generation = instance.snapshot().generation;
    await assert.rejects(instance.ensureRestoredTrack({ ...track, accountId: '99' }, generation));
    await instance.ensureRestoredTrack(track, generation);
    assert.equal((await instance.resolveTrack(hash, generation)).track.id, hash);
    transport.handlers.set('stream', async () => ({ ...stream, hash: 'b'.repeat(32), fileName: '另一首不相符的歌曲' }));
    await assert.rejects(instance.resolveTrack(hash, generation), (error: unknown) => error instanceof DomainError && error.code === 'track-mismatch');
    instance.logout(); await assert.rejects(instance.ensureRestoredTrack(track, generation));
  } finally { instance.dispose(); }
});

test('酷狗我喜欢按官方最新在前，全列表反转后再分页，整单播放保持相同顺序', async () => {
  const transport = new FakeTransport(); const service = create(() => transport);
  const rows = Array.from({ length: 650 }, (_, i) => ({ hash: i.toString(16).padStart(32, '0'), name: `合成收藏 ${i}`, duration: 30 }));
  const pages: number[] = [];
  try {
    await connect(service);
    transport.handlers.set('playlists', async () => ok({ info: [{ listid: 2, type: 0, name: '我喜欢', count: rows.length }, { listid: 3, type: 0, name: '普通歌单', count: 3 }] }));
    transport.handlers.set('playlist', async data => {
      if (data.id === '3') return ok({ count: 3, info: rows.slice(0, 3) });
      const page = Number(data.page); pages.push(page); return ok({ count: rows.length, info: rows.slice((page - 1) * 300, page * 300) });
    });
    await service.loadPlaylists(); await service.loadPlaylist('2', 0);
    assert.deepEqual(pages, [1, 2, 3]); assert.equal(service.snapshot().tracks.length, 300);
    assert.equal(service.snapshot().tracks[0]!.name, '合成收藏 649'); assert.equal(service.snapshot().tracks[299]!.name, '合成收藏 350');
    await service.loadPlaylist('2', 300); await service.loadPlaylist('2', 600);
    assert.equal(pages.length, 3); assert.equal(service.snapshot().tracks.length, 650); assert.equal(service.snapshot().tracksMore, false);
    assert.equal(service.snapshot().tracks[300]!.name, '合成收藏 349'); assert.equal(service.snapshot().tracks[649]!.name, '合成收藏 0');
    const queue = await service.preparePlaylist('2', 'owned');
    assert.deepEqual(queue.map(t => t.id), service.snapshot().tracks.map(t => t.id));
    await service.loadPlaylist('3', 0); assert.deepEqual(service.snapshot().tracks.map(t => t.name), ['合成收藏 0', '合成收藏 1', '合成收藏 2']);
    const late = deferred<unknown>(); transport.handlers.set('playlist', async () => late.promise);
    const pending = service.loadPlaylist('2', 0); service.logout(); late.resolve(ok({ count: 3, info: rows.slice(0, 3) })); await pending;
    assert.equal(service.snapshot().status, 'signed-out'); assert.deepEqual(service.snapshot().tracks, []);
  } finally { service.dispose(); }
});

test('酷狗 love 分组识别收藏列表，读取不完整时不返回反序的局部成功', async () => {
  const transport = new FakeTransport(); const service = create(() => transport);
  try {
    await connect(service);
    transport.handlers.set('playlists', async () => ok({ info: { love: [{ listid: 22, name: '我喜欢', count: 301 }], self: [], collect: [] } }));
    await service.loadPlaylists();
    transport.handlers.set('playlist', async () => ok({ count: 301, info: [{ hash, name: '合成收藏', duration: 30 }] }));
    await service.loadPlaylist('22', 0); assert.equal(service.snapshot().error?.code, 'invalid-response'); assert.equal(service.snapshot().tracks.length, 0);
  } finally { service.dispose(); }
});
