import assert from 'node:assert/strict';
import test from 'node:test';
import { DomainError } from '../../packages/contracts/src/errors.ts';
import type { NeteaseCredentialBundle } from '../../packages/contracts/src/credentials.ts';
import { initialNeteaseSnapshot, neteaseChannels, parseNeteaseArguments, parseNeteaseSnapshot } from '../../packages/contracts/src/netease.ts';
import { apiId, NeteaseService, parseNeteaseStream } from '../../packages/providers/src/netease/service.ts';
import { parseApiJson, type NeteaseEndpoint, type NeteaseTransport, type NeteaseTransportSession } from '../../packages/providers/src/netease/transport.ts';

// 明确标识的合成响应；不连接平台，不含真实二维码、凭据或账号。
const fakePng = 'data:image/png;base64,c3ludGhldGlj';
class FakeTransport implements NeteaseTransport {
  identity = false;
  cleared = false;
  session: NeteaseTransportSession | undefined;
  pollCode = 803;
  account = 42;
  handlers = new Map<NeteaseEndpoint, (data: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>>();
  async call(endpoint: NeteaseEndpoint, data: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    const handler = this.handlers.get(endpoint);
    if (handler) return handler(data, signal);
    if (endpoint === 'qrKey') return { code: 200, unikey: 'synthetic-key' };
    if (endpoint === 'qrPoll') { this.identity = this.pollCode === 803; return { code: this.pollCode }; }
    if (endpoint === 'account') return { code: 200, account: { id: this.account }, profile: { userId: this.account, nickname: '测试账号' } };
    if (endpoint === 'playlists') return { code: 200, playlist: [{ id: 1, name: '合成歌单', trackCount: 1 }], more: false };
    if (endpoint === 'playlist') return { code: 200, playlist: { id: data.id, trackIds: [{ id: 7 }] } };
    if (endpoint === 'songs') return { code: 200, songs: [{ id: 7, name: '合成曲目', ar: [{ name: '合成歌手' }], dt: 30000 }] };
    throw new Error('synthetic upstream failure');
  }
  hasIdentity(): boolean { return this.identity; }
  exportSession(): NeteaseTransportSession | undefined {
    return this.identity ? this.session ?? { cookies: { MUSIC_U: 'synthetic-music-u' }, deviceId: 'synthetic-device', nuid: 'a'.repeat(32) } : undefined;
  }
  restoreSession(session: NeteaseTransportSession): void { this.session = session; this.identity = true; }
  clear(): void { this.identity = false; this.session = undefined; this.cleared = true; }
}
function service(factory: () => FakeTransport, now = () => 1000): NeteaseService {
  return new NeteaseService({ transport: factory, encodeQr: async () => fakePng, autoPoll: false, now });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function connect(instance: NeteaseService): Promise<void> { await instance.startLogin(); await instance.pollOnce(); }

test('网易云 JSON 大整数不失真，平台 ID 只在可信边界从安全数字转字符串', () => {
  const body = parseApiJson('{"id":900719925474099312345,"count":2}') as { id: unknown; count: unknown };
  assert.equal(body.id, '900719925474099312345'); assert.equal(body.count, 2);
  assert.equal(apiId(42), '42');
  assert.throws(() => apiId(Number.MAX_SAFE_INTEGER + 1));
});

test('网易云桥接拒绝任意请求和路径，公开快照移除额外数据并在退出后清空私人列表', () => {
  for (const [channel, args] of [
    [neteaseChannels.startLogin, ['extra']], [neteaseChannels.playTrack, ['https://example.invalid/']],
    [neteaseChannels.loadPlaylist, ['1', -1]], [neteaseChannels.loadPlaylist, ['1', 5]],
    ['generic-request', []],
  ] as const) assert.throws(() => parseNeteaseArguments(channel, args));
  const initial = initialNeteaseSnapshot();
  assert.deepEqual(parseNeteaseSnapshot({ ...initial, privateMarker: 'not-public', account: { id: '42' }, tracks: [{ malformed: true }] }), initial);
  assert.throws(() => parseNeteaseSnapshot({ ...initial, status: 'waiting-scan', qrImage: 'https://example.invalid/', expiresAt: 123 }));
});

test('扫码、待确认、账号验证有独立状态；授权状态本身不能冒充已连接', async () => {
  const transport = new FakeTransport(); const instance = service(() => transport);
  try {
    assert.equal((await instance.startLogin()).status, 'waiting-scan');
    transport.pollCode = 801; assert.equal((await instance.pollOnce()).status, 'waiting-scan');
    transport.pollCode = 802; assert.equal((await instance.pollOnce()).status, 'awaiting-confirmation');
    transport.pollCode = 803; await instance.pollOnce();
    assert.equal(instance.snapshot().status, 'connected'); assert.equal(instance.snapshot().account?.id, '42');
    assert.equal(instance.snapshot().qrImage, undefined);
    await instance.loadPlaylists(); await instance.loadPlaylist('1', 0);
    assert.equal(instance.snapshot().tracks[0]?.id, '7');
    await assert.rejects(instance.loadPlaylist('999', 0));
    instance.logout();
    assert.equal(transport.cleared, true); assert.equal(instance.snapshot().account, undefined);
    assert.deepEqual(instance.snapshot().tracks, []); assert.deepEqual(instance.snapshot().playlists, []);
  } finally { instance.dispose(); }
});

test('取消后旧二维码与旧账号验证晚到，都不能覆盖新的登录过程', async () => {
  const old = new FakeTransport(); const next = new FakeTransport();
  const qr = deferred<unknown>(); let oldSignal: AbortSignal | undefined;
  old.handlers.set('qrKey', async (_data, signal) => { oldSignal = signal; return qr.promise; });
  let count = 0; const instance = service(() => count++ === 0 ? old : next);
  try {
    const pending = instance.startLogin(); instance.cancelLogin();
    await instance.startLogin(); const generation = instance.snapshot().generation;
    qr.resolve({ code: 200, unikey: 'old-synthetic-key' }); await pending;
    assert.equal(oldSignal?.aborted, true); assert.equal(instance.snapshot().generation, generation);
    const account = deferred<unknown>(); next.handlers.set('account', async () => account.promise);
    const verify = instance.pollOnce();
    await new Promise<void>((resolve) => setImmediate(resolve));
    instance.logout(); await instance.startLogin();
    account.resolve({ code: 200, account: { id: 42 }, profile: { userId: 42, nickname: '旧账号' } }); await verify;
    assert.equal(instance.snapshot().status, 'waiting-scan'); assert.equal(instance.snapshot().account, undefined);
  } finally { instance.dispose(); }
});

test('旧账号歌单响应与旧页面曲目响应不会回写新账号或新歌单', async () => {
  const first = new FakeTransport(); const second = new FakeTransport(); second.account = 43;
  let count = 0; const instance = service(() => count++ === 0 ? first : second);
  try {
    await connect(instance);
    const list = deferred<unknown>(); first.handlers.set('playlists', async () => list.promise);
    const pending = instance.loadPlaylists(); instance.logout(); await connect(instance);
    list.resolve({ code: 200, playlist: [{ id: 9, name: '旧账号歌单', trackCount: 2 }], more: false }); await pending;
    assert.equal(instance.snapshot().account?.id, '43'); assert.deepEqual(instance.snapshot().playlists, []);
    second.handlers.set('playlists', async () => ({ code: 200, playlist: [{ id: 1, name: 'A', trackCount: 1 }, { id: 2, name: 'B', trackCount: 1 }], more: false }));
    await instance.loadPlaylists();
    const oldDetail = deferred<unknown>();
    second.handlers.set('playlist', async (data) => data.id === '1' ? oldDetail.promise : { code: 200, playlist: { id: 2, trackIds: [{ id: 7 }] } });
    const a = instance.loadPlaylist('1', 0); await instance.loadPlaylist('2', 0);
    oldDetail.resolve({ code: 200, playlist: { id: 1, trackIds: [] } }); await a;
    assert.equal(instance.snapshot().playlistId, '2'); assert.equal(instance.snapshot().tracks[0]?.id, '7');
  } finally { instance.dispose(); }
});

test('二维码到期、缺少身份、账号不一致和服务鉴权过期均清理临时状态', async () => {
  let now = 1000; const transport = new FakeTransport(); const instance = service(() => transport, () => now);
  try {
    await instance.startLogin(); now += 180001; assert.equal((await instance.pollOnce()).status, 'expired');
    now = 1000; await instance.startLogin();
    transport.handlers.set('qrPoll', async () => ({ code: 803 }));
    assert.equal((await instance.pollOnce()).status, 'failed');
    transport.handlers.delete('qrPoll');
    transport.handlers.set('account', async () => ({ code: 200, account: { id: 1 }, profile: { userId: 2, nickname: '不一致' } }));
    await connect(instance); assert.equal(instance.snapshot().status, 'failed');
    transport.handlers.delete('account'); await connect(instance);
    transport.handlers.set('playlists', async () => { throw new DomainError('session-expired'); });
    await instance.loadPlaylists(); assert.equal(instance.snapshot().status, 'expired'); assert.equal(transport.cleared, true);
  } finally { instance.dispose(); }
});

test('流解析严格绑定曲目 ID，保留试听/实际音质，不接受其他域名或任意 Cookie 头', () => {
  const result = { code: 200, data: [{ id: 7, code: 200, url: 'http://m1.music.126.net/synthetic-audio', br: 128000, type: 'mp3', level: 'standard', expi: 60, freeTrialInfo: { start: 0, end: 30 } }] };
  const stream = parseNeteaseStream(result, '7', 1000);
  assert.equal(stream.source.kind, 'remote'); assert.equal(stream.quality.bitrateKbps, 128); assert.equal(stream.access.kind, 'preview');
  assert.throws(() => parseNeteaseStream(result, '8', 1000));
  assert.throws(() => parseNeteaseStream({ ...result, data: [{ ...result.data[0], url: 'https://music.126.net.evil.invalid/audio' }] }, '7', 1000));
  assert.throws(() => parseNeteaseStream({ ...result, data: [{ ...result.data[0], freeTrialInfo: { start: 30, end: 0 } }] }, '7', 1000));
  assert.throws(() => parseNeteaseStream({ code: 200, data: [{ id: 7, code: 403, url: null }] }, '7', 1000), DomainError);
});

test('网易云成功登录可导出凭据并从凭据恢复', async () => {
  let emitted: NeteaseCredentialBundle | undefined;
  const transport = new FakeTransport();
  const instance = new NeteaseService({ transport: () => transport, encodeQr: async () => fakePng, autoPoll: false, now: () => 1000, onCredentials: (bundle) => { emitted = bundle; } });
  try {
    await connect(instance);
    assert.equal(emitted?.provider, 'netease');
    const bundle = instance.exportCredentials();
    assert.ok(bundle);
    assert.equal(bundle.cookies.MUSIC_U, 'synthetic-music-u');
    const restoredTransport = new FakeTransport();
    const restored = new NeteaseService({ transport: () => restoredTransport, encodeQr: async () => fakePng, autoPoll: false, now: () => 1000 });
    try {
      const snapshot = await restored.restoreCredentials(bundle);
      assert.equal(snapshot.status, 'connected');
      assert.equal(snapshot.account?.id, '42');
      assert.equal(restoredTransport.identity, true);
    } finally { restored.dispose(); }
  } finally { instance.dispose(); }
});


test('网易云歌词和封面仅对已登记曲目读取，公开歌单不携带封面原地址', async () => {
  const transport = new FakeTransport();
  const instance = new NeteaseService({ transport: () => transport, encodeQr: async () => fakePng, autoPoll: false,
    artwork: async (url, provider) => { assert.equal(url, 'https://p1.music.126.net/synthetic.jpg'); assert.equal(provider, 'netease'); return 'data:image/jpeg;base64,/9j/AQ=='; },
  });
  try {
    await connect(instance); await instance.loadPlaylists();
    transport.handlers.set('songs', async () => ({ code: 200, songs: [{ id: 7, name: '合成曲目', ar: [{ name: '合成歌手' }], dt: 30000, al: { name: '合成专辑', picUrl: 'https://p1.music.126.net/synthetic.jpg' } }] }));
    await instance.loadPlaylist('1', 0);
    transport.handlers.set('lyric', async data => { assert.equal(data.id, '7'); return { code: 200, lrc: { lyric: '[00:01.00]合成网易歌词' } }; });
    assert.equal(JSON.stringify(instance.snapshot()).includes('synthetic.jpg'), false);
    const data = await instance.getPresentation('7', instance.snapshot().generation);
    assert.deepEqual(data.lyrics, [{ timeMs: 1000, text: '合成网易歌词' }]);
    assert.equal(data.album, '合成专辑'); assert.match(data.artwork!, /^data:image/);
    transport.handlers.set('lyric', async () => { throw new DomainError('network'); });
    const partial = await instance.getPresentation('7', instance.snapshot().generation);
    assert.equal(partial.lyrics.length, 0); assert.equal(partial.lyricsError?.code, 'network'); assert.ok(partial.artwork);
    await assert.rejects(instance.getPresentation('9', instance.snapshot().generation));
    const pendingLyric = deferred<unknown>(); transport.handlers.set('lyric', async () => pendingLyric.promise);
    const old = instance.getPresentation('7', instance.snapshot().generation);
    instance.logout(); pendingLyric.resolve({ code: 200, lrc: { lyric: '[00:00]旧歌词' } });
    await assert.rejects(old);
  } finally { instance.dispose(); }
});
