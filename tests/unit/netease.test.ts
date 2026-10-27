import { parseNeteaseArtwork, parseNeteaseArtworkRequest } from '../../packages/contracts/src/netease-artwork.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { DomainError } from '../../packages/contracts/src/errors.ts';
import type { NeteaseCredentialBundle } from '../../packages/contracts/src/credentials.ts';
import { initialNeteaseSnapshot, neteaseChannels, parseNeteaseArguments, parseNeteaseSnapshot } from '../../packages/contracts/src/netease.ts';
import { apiId, NeteaseService, parseNeteaseStream } from '../../packages/providers/src/netease/service.ts';
import { parseApiJson, type NeteaseEndpoint, type NeteaseTransport, type NeteaseTransportSession } from '../../packages/providers/src/netease/transport.ts';
import { initialCatalog, parseCatalog, parseCatalogRequest } from '../../packages/contracts/src/netease-catalog.ts';

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

test('发现与搜索契约限制类型、关键词、分页、ID，投影不暴露额外字段', () => {
  const search = { kind: 'search', query: '  合成歌曲  ', searchType: 'songs', offset: 0 };
  assert.deepEqual(parseNeteaseArguments(neteaseChannels.browse, [search]).catalog, { ...search, query: '合成歌曲' });
  for (const value of [{ ...search, query: '' }, { ...search, query: 'x'.repeat(101) }, { ...search, query: 'x\n' }, { ...search, offset: 1 }, { ...search, offset: 3030 }, { ...search, searchType: 'url' }, { ...search, url: 'https://example.invalid/' }, { kind: 'playlist', id: 'https://example.invalid/', offset: 0 }]) assert.throws(() => parseCatalogRequest(value));
  assert.throws(() => parseNeteaseArguments(neteaseChannels.browse, [search, 'extra']));
  assert.deepEqual(parseCatalog({ ...initialCatalog(), privateMarker: 'hidden' }), initialCatalog());
  assert.throws(() => parseCatalog({ ...initialCatalog(), tracks: Array(31).fill({}) }));
});

test('匿名热歌与公开歌单真实归一化路径、登记 ID 与分页顺序，不冒充登录', async () => {
  const transport = new FakeTransport(); const instance = service(() => transport);
  transport.handlers.set('toplists', async () => ({ code: 200, list: [{ id: 123, name: '云音乐热歌榜', trackCount: 32 }] }));
  transport.handlers.set('playlist', async data => ({ code: 200, playlist: { id: data.id, trackIds: Array.from({ length: 32 }, (_, index) => ({ id: index + 1 })) } }));
  transport.handlers.set('songs', async data => ({ code: 200, songs: (JSON.parse(data.c as string) as { id: string }[]).reverse().map(({ id }) => ({ id, name: `合成 ${id}`, ar: [{ name: '合成歌手' }], dt: 30000 })) }));
  transport.handlers.set('publicPlaylists', async data => { assert.equal(data.cat, '华语'); assert.equal(data.order, 'new'); return { code: 200, playlists: [{ id: 99, name: '合成公开歌单', trackCount: 32, coverImgUrl: 'https://private.invalid/' }], more: false, total: 1 }; });
  try {
    await instance.browse({ kind: 'hot', category: '全部', order: 'hot', offset: 0 });
    assert.equal(instance.snapshot().status, 'signed-out');
    assert.deepEqual(instance.snapshot().catalog.tracks.map(track => track.id), Array.from({ length: 30 }, (_, index) => String(index + 1)));
    assert.equal(instance.snapshot().catalog.more, true);
    await instance.browse({ kind: 'hot', category: '全部', order: 'hot', offset: 30 });
    assert.deepEqual(instance.snapshot().catalog.tracks.map(track => track.id), ['31', '32']); assert.equal(instance.snapshot().catalog.more, false);
    await instance.browse({ kind: 'playlists', category: '华语', order: 'new', offset: 0 });
    assert.equal(JSON.stringify(instance.snapshot()).includes('private.invalid'), false);
    await assert.rejects(instance.browse({ kind: 'playlist', id: '666', offset: 0 }));
    await instance.browse({ kind: 'playlist', id: '99', offset: 0 });
    assert.equal(instance.snapshot().catalog.playlist?.name, '合成公开歌单');
    transport.handlers.set('playlist', async () => { throw new DomainError('network'); });
    await instance.browse({ kind: 'playlist', id: '99', offset: 0 });
    assert.equal(instance.snapshot().catalog.status, 'error');
    assert.equal(instance.snapshot().catalog.playlist?.id, '99');
    await assert.rejects(instance.resolveTrack('1', instance.snapshot().generation));
  } finally { instance.dispose(); }
});

test('歌曲/歌单搜索分别归一化，空结果与限流不伪造成功数据', async () => {
  const transport = new FakeTransport(); const instance = service(() => transport);
  transport.handlers.set('search', async data => {
    assert.equal(data.limit, 30); assert.equal(data.offset, 30);
    return data.type === 1 ? { code: 200, result: { songCount: 32, songs: [{ id: 7, name: '合成歌曲', artists: [{ name: '合成歌手' }], duration: 30000, album: { name: '合成专辑', picUrl: 'https://p1.music.126.net/synthetic.jpg' } }] } }
      : { code: 200, result: { playlistCount: 31, playlists: [{ id: 9, name: '合成搜索歌单', trackCount: 1 }] } };
  });
  try {
    await instance.browse({ kind: 'search', query: '合成', searchType: 'songs', offset: 30 });
    assert.equal(instance.snapshot().catalog.tracks[0]?.durationMs, 30000);
    assert.equal(instance.snapshot().catalog.more, true);
    assert.equal(JSON.stringify(instance.snapshot()).includes('synthetic.jpg'), false);
    await instance.browse({ kind: 'search', query: '合成', searchType: 'playlists', offset: 30 });
    assert.equal(instance.snapshot().catalog.playlists[0]?.id, '9');
    transport.handlers.set('search', async () => ({ code: 200, result: { songCount: 0 } }));
    await instance.browse({ kind: 'search', query: '不存在', searchType: 'songs', offset: 0 });
    assert.equal(instance.snapshot().catalog.status, 'ready'); assert.deepEqual(instance.snapshot().catalog.tracks, []);
    transport.handlers.set('search', async () => ({ code: 429, message: 'upstream secret' }));
    await instance.browse({ kind: 'search', query: '合成', searchType: 'songs', offset: 0 });
    assert.equal(instance.snapshot().catalog.status, 'error'); assert.equal(instance.snapshot().catalog.error?.code, 'rate-limited');
    assert.equal(JSON.stringify(instance.snapshot()).includes('upstream secret'), false);
  } finally { instance.dispose(); }
});

test('新搜索和退出会取消旧请求，旧搜索成功/失败均不能覆盖新结果', async () => {
  const transport = new FakeTransport(); const instance = service(() => transport);
  const pending = deferred<unknown>(); let oldSignal: AbortSignal | undefined;
  transport.handlers.set('search', async (data, signal) => {
    if (data.s === '旧') { oldSignal = signal; return pending.promise; }
    return { code: 200, result: { songCount: 1, songs: [{ id: 8, name: '新结果', ar: [], dt: 1000 }] } };
  });
  try {
    const old = instance.browse({ kind: 'search', query: '旧', searchType: 'songs', offset: 0 });
    await instance.browse({ kind: 'search', query: '新', searchType: 'songs', offset: 0 });
    pending.resolve({ code: 403 }); await old;
    assert.equal(oldSignal?.aborted, true); assert.equal(instance.snapshot().catalog.tracks[0]?.id, '8');
    const late = deferred<unknown>(); transport.handlers.set('search', async () => late.promise);
    const operation = instance.browse({ kind: 'search', query: '迟到', searchType: 'songs', offset: 0 });
    instance.logout(); late.resolve({ code: 200, result: { songCount: 0 } }); await operation;
    assert.deepEqual(instance.snapshot().catalog, initialCatalog());
  } finally { instance.dispose(); }
});

test('已登录搜索结果可按登记 ID 解析和取歌词，切账号清空发现登记', async () => {
  const first = new FakeTransport(); const second = new FakeTransport(); second.account = 43;
  let count = 0; const instance = service(() => count++ === 0 ? first : second);
  first.handlers.set('search', async () => ({ code: 200, result: { songCount: 1, songs: [{ id: 7, name: '合成搜索曲目', ar: [], dt: 30000 }] } }));
  first.handlers.set('stream', async data => { assert.equal(data.ids, '["7"]'); return { code: 200, data: [{ id: 7, code: 200, url: 'https://m1.music.126.net/synthetic', type: 'mp3' }] }; });
  first.handlers.set('lyric', async () => ({ code: 200, lrc: { lyric: '[00:00]合成歌词' } }));
  try {
    await connect(instance);
    await instance.browse({ kind: 'search', query: '合成', searchType: 'songs', offset: 0 });
    const generation = instance.snapshot().generation;
    assert.equal((await instance.resolveTrack('7', generation)).track.id, '7');
    assert.equal((await instance.getPresentation('7', generation)).lyrics.length, 1);
    instance.logout(); await connect(instance);
    assert.deepEqual(instance.snapshot().catalog, initialCatalog());
    await assert.rejects(instance.resolveTrack('7', instance.snapshot().generation));
  } finally { instance.dispose(); }
});


test('封面桥接仅接受具体资源 ID/种类/代次，响应只允许有界栅格数据', () => {
  const request = { kind: 'playlist', id: '99', generation: 1 };
  assert.deepEqual(parseNeteaseArguments(neteaseChannels.getArtwork, [request]).artwork, request);
  for (const value of [{ ...request, url: 'https://example.invalid' }, { ...request, kind: 'url' }, { ...request, id: '../x' }, { ...request, generation: -1 }]) assert.throws(() => parseNeteaseArtworkRequest(value));
  for (const value of [undefined, 'https://p1.music.126.net/x', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,' + 'x'.repeat(750000)]) assert.throws(() => parseNeteaseArtwork(value));
  assert.equal(parseNeteaseArtwork(null), null);
});

test('匿名歌单/搜索曲目封面按登记 ID 获取、去查询参数、复用下载且不暴露远程地址', async () => {
  const transport = new FakeTransport(); const urls: string[] = [];
  transport.handlers.set('publicPlaylists', async () => ({ code: 200, more: false, playlists: [{ id: 99, name: '合成封面歌单', trackCount: 1, coverImgUrl: 'http://p1.music.126.net/synthetic.jpg?tracking=synthetic' }, { id: 98, name: '合成无图歌单', trackCount: 0 }, { id: 97, name: '合成越界图片', trackCount: 0, coverImgUrl: 'https://example.invalid/image.jpg' }] }));
  transport.handlers.set('search', async () => ({ code: 200, result: { songCount: 1, songs: [{ id: 7, name: '合成歌曲', ar: [], dt: 1000, al: { picUrl: 'https://p2.music.126.net/track.jpg' } }] } }));
  const instance = new NeteaseService({ transport: () => transport, artwork: async url => { urls.push(url); return 'data:image/jpeg;base64,/9j/AQ=='; } });
  try {
    await instance.browse({ kind: 'playlists', category: '全部', order: 'hot', offset: 0 });
    const generation = instance.snapshot().generation;
    assert.equal(JSON.stringify(instance.snapshot()).includes('music.126.net'), false);
    const request = { kind: 'playlist' as const, id: '99', generation };
    await Promise.all([instance.getArtwork(request), instance.getArtwork(request)]);
    await instance.getArtwork(request);
    assert.deepEqual(urls, ['https://p1.music.126.net/synthetic.jpg?param=400y400']);
    assert.equal(await instance.getArtwork({ ...request, id: '98' }), null);
    await assert.rejects(instance.getArtwork({ ...request, id: '97' }));
    await assert.rejects(instance.getArtwork({ ...request, id: '666' }));
    await instance.browse({ kind: 'search', query: '合成', searchType: 'songs', offset: 0 });
    assert.match((await instance.getArtwork({ kind: 'track', id: '7', generation }))!, /^data:image/);
    assert.equal(urls.length, 2);
    instance.logout();
    await assert.rejects(instance.getArtwork(request));
    await assert.rejects(instance.getArtwork({ ...request, generation: instance.snapshot().generation }));
  } finally { instance.dispose(); }
});

test('封面限制并发，退出取消下载且拒绝迟到图片；私人歌单也能读取图片', async () => {
  const transport = new FakeTransport(); const pending = deferred<string>(); let signal: AbortSignal | undefined;
  transport.handlers.set('publicPlaylists', async () => ({ code: 200, more: false, playlists: Array.from({ length: 5 }, (_, index) => ({ id: index + 1, name: '合成歌单', trackCount: 1, coverImgUrl: `https://p1.music.126.net/${index}.jpg` })) }));
  transport.handlers.set('playlists', async () => ({ code: 200, more: false, playlist: [{ id: 10, name: '合成私人歌单', trackCount: 1, coverImgUrl: 'https://p1.music.126.net/private.jpg' }] }));
  const instance = new NeteaseService({ transport: () => transport, autoPoll: false, encodeQr: async () => fakePng, artwork: async (_url, _provider, current) => { signal = current; return pending.promise; } });
  try {
    await instance.browse({ kind: 'playlists', category: '全部', order: 'hot', offset: 0 });
    const generation = instance.snapshot().generation;
    const operations = [1,2,3,4].map(id => instance.getArtwork({ kind: 'playlist', id: String(id), generation }));
    await assert.rejects(instance.getArtwork({ kind: 'playlist', id: '5', generation }));
    instance.logout(); assert.equal(signal?.aborted, true);
    pending.resolve('data:image/jpeg;base64,/9j/AQ==');
    assert.equal((await Promise.allSettled(operations)).every(value => value.status === 'rejected'), true);
    await connect(instance); await instance.loadPlaylists();
    assert.match((await instance.getArtwork({ kind: 'playlist', id: '10', generation: instance.snapshot().generation }))!, /^data:image/);
  } finally { instance.dispose(); }
});

test('官方 fee 分类与独立 privilege 按 ID 归并，缺数据不误标免费或完整播放', async () => {
  const { parseTracks } = await import('../../packages/providers/src/netease/response.ts');
  const rows = [0, 1, 4, 8, 99].map((fee, index) => ({ id: index + 1, name: '合成权限曲目', ar: [], dt: 30000, fee }));
  const result = parseTracks(rows, [{ id: 2, pl: 999000, st: 0, cookie: 'synthetic' }, { id: 1, pl: 0, st: -200 }]);
  assert.deepEqual(result.map(track => track.rights?.fee), ['none', 'vip', 'album', 'vip-quality', 'unknown']);
  assert.equal(result[0]?.rights?.playback, 'unavailable');
  assert.equal(result[1]?.rights?.playback, 'unknown'); // pl 不是完整播放授权证明
  assert.equal(result[1]?.rights?.maxBitrate, 999000);
  assert.equal(JSON.stringify(result).includes('cookie'), false);
  assert.equal(parseTracks([{ id: 9, name: '合成缺权限', ar: [], dt: 1000 }])[0]?.rights, undefined);
  assert.throws(() => parseTracks([{ id: 9, name: '合成错配', ar: [], dt: 1000, privilege: { id: 8 } }]));
});

test('会员投影只认官方套餐有效期和账号，过期/缺字段/额外数据不制造 VIP', async () => {
  const { parseMembershipResponse } = await import('../../packages/providers/src/netease/response.ts');
  const { parseNeteaseTrackRights } = await import('../../packages/contracts/src/netease-rights.ts');
  const reply = { code: 200, data: { userId: 42, redVipLevel: 7, associator: { vipCode: 100, expireTime: 2000 }, musicPackage: { vipCode: 230, expireTime: 500 }, redplus: { vipCode: 300, expireTime: 3000 }, token: 'synthetic-secret' } };
  const member = parseMembershipResponse(reply, '42', 1000);
  assert.deepEqual(member.benefits, [{ kind: 'vip', expiresAt: 2000 }, { kind: 'svip', expiresAt: 3000 }]);
  assert.equal(JSON.stringify(member).includes('secret'), false);
  assert.equal(parseMembershipResponse(reply, '42', 4000).benefits.length, 0);
  assert.throws(() => parseMembershipResponse({ code: 200, data: { userId: 42, associator: null } }, '42', 1000));
  assert.equal(parseMembershipResponse({ code: 200, data: { userId: 42, associator: null, musicPackage: null } }, '42', 1000).benefits.length, 0);
  assert.throws(() => parseMembershipResponse(reply, '43', 1000));
  assert.throws(() => parseMembershipResponse({ code: 200, data: { userId: 42, redVipLevel: 7 } }, '42', 1000));
  assert.throws(() => parseNeteaseTrackRights({ fee: 'free', playback: 'full' }));
  assert.deepEqual(parseNeteaseArguments(neteaseChannels.refreshMembership, []), {});
  assert.throws(() => parseNeteaseArguments(neteaseChannels.refreshMembership, ['42']));
  assert.deepEqual(parseNeteaseSnapshot({ ...initialNeteaseSnapshot(), membership: member }).membership.benefits, []);
});

test('登录与恢复后同步当前账号官方 VIP，失败只显示未知；旧账号响应不能回写', async () => {
  const first = new FakeTransport(); const second = new FakeTransport(); second.account = 43;
  const pending = deferred<unknown>(); let oldSignal: AbortSignal | undefined;
  first.handlers.set('vip', async (data, signal) => { assert.equal(data.userId, '42'); oldSignal = signal; return pending.promise; });
  second.handlers.set('vip', async data => { assert.equal(data.userId, '43'); return { code: 200, data: { userId: 43, associator: { vipCode: 100, expireTime: 5000 }, musicPackage: null } }; });
  let count = 0; const instance = service(() => count++ === 0 ? first : second);
  try {
    await connect(instance); assert.equal(instance.snapshot().membership.status, 'loading');
    instance.logout(); assert.equal(oldSignal?.aborted, true);
    await connect(instance); await new Promise(done => setImmediate(done));
    assert.equal(instance.snapshot().membership.benefits[0]?.kind, 'vip');
    pending.resolve({ code: 200, data: { userId: 42, associator: null } });
    await new Promise(done => setImmediate(done));
    assert.equal(instance.snapshot().account?.id, '43'); assert.equal(instance.snapshot().membership.benefits[0]?.kind, 'vip');
    const bundle = instance.exportCredentials()!;
    instance.logout(); assert.equal(instance.snapshot().membership.status, 'idle');
    await instance.restoreCredentials(bundle); await new Promise(done => setImmediate(done));
    assert.equal(instance.snapshot().membership.benefits[0]?.kind, 'vip');
    second.handlers.set('vip', async () => { throw new DomainError('network'); });
    await instance.refreshMembership();
    assert.equal(instance.snapshot().status, 'connected'); assert.equal(instance.snapshot().membership.status, 'error');
    assert.equal(instance.snapshot().membership.benefits.length, 0);
  } finally { pending.resolve({ code: 500 }); instance.dispose(); }
});

test('实际取链沿用官方登录权限并请求最高既有码率，VIP/付费标签不冒充整曲', async () => {
  const transport = new FakeTransport(); const instance = service(() => transport);
  transport.handlers.set('vip', async () => ({ code: 200, data: { userId: 42, associator: { vipCode: 100, expireTime: 5000 } } }));
  transport.handlers.set('search', async () => ({ code: 200, result: { songCount: 1, songs: [{ id: 7, name: '合成 VIP 歌曲', ar: [], dt: 30000, fee: 1 }] } }));
  let preview = true;
  transport.handlers.set('stream', async data => {
    assert.equal(transport.identity, true); assert.equal(data.ids, '["7"]'); assert.equal(data.br, 999000);
    return { code: 200, data: [{ id: 7, code: 200, url: 'https://m1.music.126.net/synthetic', br: preview ? 128000 : 900000, type: preview ? 'mp3' : 'flac', freeTrialInfo: preview ? { start: 10, end: 40 } : null }] };
  });
  try {
    await connect(instance); await new Promise(done => setImmediate(done));
    await instance.browse({ kind: 'search', query: '合成', searchType: 'songs', offset: 0 });
    assert.equal(instance.snapshot().catalog.tracks[0]?.rights?.playback, 'unknown');
    const trial = await instance.resolveTrack('7', instance.snapshot().generation);
    assert.equal(trial.access.kind, 'preview'); assert.equal(instance.snapshot().catalog.tracks[0]?.rights?.playback, 'preview');
    preview = false;
    const full = await instance.resolveTrack('7', instance.snapshot().generation);
    assert.equal(full.access.kind, 'full'); assert.equal(full.quality.level, 'lossless');
    assert.deepEqual(instance.snapshot().catalog.tracks[0]?.rights, { fee: 'vip', playback: 'full' });
    transport.handlers.set('stream', async () => ({ code: 200, data: [{ id: 7, code: 403 }] }));
    await assert.rejects(instance.resolveTrack('7', instance.snapshot().generation));
    assert.equal(instance.snapshot().catalog.tracks[0]?.rights?.playback, 'unavailable');
    assert.equal(instance.snapshot().membership.benefits[0]?.kind, 'vip'); // 有会员不等于所有单曲均可播
  } finally { instance.dispose(); }
});

test('同步权益刷新当前单曲权限，迟到详情不覆盖新搜索；单曲刷新失败保留已核验会员', async () => {
  const transport = new FakeTransport(); const instance = service(() => transport);
  transport.handlers.set('vip', async () => ({ code: 200, data: { userId: 42, associator: { vipCode: 100, expireTime: 5000 } } }));
  transport.handlers.set('search', async data => ({ code: 200, result: { songCount: 1, songs: [{ id: data.s === '旧' ? 7 : 8, name: String(data.s), ar: [], dt: 30000, fee: 1 }] } }));
  try {
    await connect(instance); await new Promise(done => setImmediate(done));
    await instance.browse({ kind: 'search', query: '旧', searchType: 'songs', offset: 0 });
    const pending = deferred<unknown>(); let requested = false;
    transport.handlers.set('songs', async () => { requested = true; return pending.promise; });
    const refresh = instance.refreshMembership(); await new Promise(done => setImmediate(done)); assert.equal(requested, true);
    await instance.browse({ kind: 'search', query: '新', searchType: 'songs', offset: 0 });
    pending.resolve({ code: 200, songs: [{ id: 7, name: '迟到旧详情', ar: [], dt: 30000, fee: 1 }], privileges: [{ id: 7, pl: 999000, st: 0 }] });
    await refresh;
    assert.equal(instance.snapshot().catalog.tracks[0]?.name, '新');
    transport.handlers.set('songs', async () => ({ code: 200, songs: [{ id: 8, name: '新', ar: [], dt: 30000, fee: 4 }], privileges: [{ id: 8, pl: 0, st: -200 }] }));
    await instance.refreshMembership();
    assert.equal(instance.snapshot().catalog.tracks[0]?.rights?.fee, 'album');
    assert.equal(instance.snapshot().catalog.tracks[0]?.rights?.playback, 'unavailable');
    transport.handlers.set('songs', async () => { throw new DomainError('network'); });
    await instance.refreshMembership();
    assert.equal(instance.snapshot().membership.status, 'ready'); assert.equal(instance.snapshot().membership.benefits[0]?.kind, 'vip');
    assert.equal(instance.snapshot().membership.error?.code, 'network');
  } finally { instance.dispose(); }
});


test('会员兼容省略 userId/vipCode、字符串到期日及 App 明确权益，格式不兼容才回退', async () => {
  const { parseMembershipResponse } = await import('../../packages/providers/src/netease/response.ts');
  assert.equal(parseMembershipResponse({ code: 200, data: { associator: { expireTime: '5000' } } }, '42', 1000).benefits[0]?.kind, 'vip');
  assert.deepEqual(parseMembershipResponse({ code: 200, data: { vipInfo: { redplus: { rights: true } } } }, '42', 1000).benefits, [{ kind: 'svip' }]);
  assert.equal(parseMembershipResponse({ code: 200, data: { associator: { rights: false, expireTime: 5000 }, musicPackage: null } }, '42', 1000).benefits.length, 0);
  const transport = new FakeTransport(); const instance = service(() => transport); let fallback = 0;
  transport.handlers.set('vip', async () => ({ code: 200, data: {} }));
  transport.handlers.set('vipClient', async () => { fallback++; return { code: 200, data: { associator: { rights: true } } }; });
  try {
    await connect(instance); await new Promise(done => setImmediate(done));
    assert.equal(instance.snapshot().membership.status, 'ready'); assert.equal(fallback, 1);
    transport.handlers.set('vip', async () => { throw new DomainError('network'); });
    await instance.refreshMembership(); assert.equal(fallback, 1);
  } finally { instance.dispose(); }
});

test('整单准备读取全部 trackIds 并分批归并详情，不截断到当前页或提前取音频', async () => {
  const transport = new FakeTransport(); const instance = service(() => transport); const sizes: number[] = [];
  transport.handlers.set('playlist', async data => ({ code: 200, playlist: { id: data.id, trackIds: Array.from({ length: 1300 }, (_, index) => ({ id: index + 1 })) } }));
  transport.handlers.set('songs', async data => {
    const ids = JSON.parse(data.c as string) as { id: string }[]; sizes.push(ids.length);
    return { code: 200, songs: ids.reverse().map(({ id }) => ({ id, name: `合成 ${id}`, ar: [], dt: 30000 })) };
  });
  try {
    await connect(instance); await instance.loadPlaylists();
    const tracks = await instance.preparePlaylist('1');
    assert.deepEqual(sizes.sort((a,b)=>a-b), [300,1000]);
    assert.equal(tracks.length, 1300); assert.equal(tracks[0]?.id, '1'); assert.equal(tracks[1299]?.id, '1300');
    await assert.rejects(instance.preparePlaylist('99999'));
    const late = deferred<unknown>(); transport.handlers.set('playlist', async () => late.promise);
    const request = instance.preparePlaylist('1'); instance.logout();
    late.resolve({ code: 200, playlist: { id: 1, trackIds: [] } });
    await assert.rejects(request);
  } finally { instance.dispose(); }
});
