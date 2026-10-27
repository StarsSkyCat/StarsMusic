import assert from 'node:assert/strict';
import test from 'node:test';
import { KugouService } from '../../packages/providers/src/kugou/service.ts';
import { DirectKugouTransport, type KugouEndpoint, type KugouTransport } from '../../packages/providers/src/kugou/transport.ts';
import { initialKugouSnapshot, kugouChannels, parseKugouArguments } from '../../packages/contracts/src/kugou.ts';
import { parseKugouArtwork, parseKugouArtworkRequest } from '../../packages/contracts/src/kugou-artwork.ts';
import { parseKugouCatalogRequest, parseKugouQueue } from '../../packages/contracts/src/kugou-catalog.ts';
import { artworkUrl } from '../../packages/providers/src/artwork.ts';

// 全部合成数据，不连接平台或使用真实账号。
const hash = 'a'.repeat(32); const image = 'data:image/png;base64,c3ludGhldGlj';
const ok = (data: unknown) => ({ status: 1, error_code: 0, data });
const song = (id = hash) => ({ hash: id, name: '合成歌曲', singerinfo: [{ name: '合成歌手' }], duration: 30, cover: 'https://imge.kugou.com/synthetic.jpg' });
class Transport implements KugouTransport {
  handlers = new Map<KugouEndpoint, (data: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>>();
  calls: { endpoint: KugouEndpoint; data: Record<string, unknown> }[] = [];
  acceptIdentity() {} exportSession() { return undefined; } restoreSession() {} clear() {}
  async call(endpoint: KugouEndpoint, data: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    this.calls.push({ endpoint, data }); const handler = this.handlers.get(endpoint); if (handler) return handler(data, signal);
    if (endpoint === 'register') return ok({});
    if (endpoint === 'qrKey') return ok({ qrcode: 'synthetic' });
    if (endpoint === 'qrPoll') return ok({ status: 4, userid: '42', token: 'synthetic-private-marker' });
    if (endpoint === 'account') return ok({ userid: '42', nickname: '合成账号' });
    if (endpoint === 'playlists') return ok({ info: [{ listid: 1, name: '合成私人歌单', count: 1, pic: 'https://imge.kugou.com/private.jpg' }] });
    if (endpoint === 'playlist') return ok({ count: 1, info: [song()] });
    if (endpoint === 'searchSongs') return ok({ total: 31, lists: [{ FileHash: hash.toUpperCase(), SongName: '合成搜索歌曲', Singers: [{ name: '合成歌手' }], Duration: '30', AlbumImage: 'https://imge.kugou.com/search.jpg' }] });
    if (endpoint === 'searchPlaylists') return ok({ total: 1, lists: [{ gid: 'collection_1_synthetic', specialname: '合成搜索歌单', song_count: 1, img: 'https://imge.kugou.com/playlist.jpg' }] });
    if (endpoint === 'publicPlaylists') return ok({ has_next: 1, special_list: Array.from({ length: 35 }, (_, i) => ({ global_collection_id: `collection_${i}_synthetic`, specialname: `合成公开歌单 ${i}`, percount: 0, imgurl: 'https://c1.kgimg.com/custom/{size}/synthetic.jpg' })) });
    if (endpoint === 'publicPlaylist') return ok({ list_info: { global_collection_id: data.id, name: '合成公开详情', count: 1 }, count: 1, songs: [song()] });
    return { status: 1, hash, fileName: '合成搜索歌曲', priv_status: 0, url: ['https://fsandroid.kugou.com/synthetic'] };
  }
}
function fixture() {
  const transport = new Transport(); let downloads = 0;
  const service = new KugouService({ transport: () => transport, autoPoll: false, encodeQr: async () => image, artwork: async () => { downloads++; return image; } });
  return { transport, service, downloads: () => downloads };
}
async function connect(service: KugouService) { await service.startLogin(); await service.pollOnce(); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

test('酷狗发现/图片/整单 IPC 只接受有界具体参数，拒绝 URL、任意字段和 SVG', () => {
  assert.deepEqual(parseKugouArguments(kugouChannels.browse, [{ kind: 'search', query: ' 合成 ', searchType: 'songs', offset: 30 }]).catalog, { kind: 'search', query: '合成', searchType: 'songs', offset: 30 });
  for (const value of [{ kind: 'search', query: '', searchType: 'songs', offset: 0 }, { kind: 'search', query: 'x'.repeat(101), searchType: 'songs', offset: 0 }, { kind: 'playlists', offset: 1 }, { kind: 'playlists', offset: 3030 }, { kind: 'playlists', offset: 0, url: 'https://example.invalid' }, { kind: 'playlist', id: '../x', offset: 0 }]) assert.throws(() => parseKugouCatalogRequest(value));
  assert.throws(() => parseKugouArguments(kugouChannels.playPlaylist, ['1', 'url']));
  assert.throws(() => parseKugouArtworkRequest({ id: hash, kind: 'track', generation: 0, url: 'https://example.invalid' }));
  assert.throws(() => parseKugouArtwork('data:image/svg+xml;base64,PHN2Zz4='));
  assert.throws(() => parseKugouArtwork('https://imge.kugou.com/remote.jpg'));
  assert.throws(() => parseKugouQueue([{ id: hash, name: '合成', artists: [], durationMs: 0 }, { id: hash, name: '重复', artists: [], durationMs: 0 }]));
  assert.equal(artworkUrl('http://c1.kgimg.com/custom/{size}/synthetic.jpg', 'kugou').hostname, 'c1.kgimg.com');
  assert.throws(() => artworkUrl('https://other.kgimg.com/synthetic.jpg', 'kugou'));
});

test('匿名推荐保留额外卡片，双类型搜索归一字段，详情只读已登记歌单，图片缓存不泄露源地址', async () => {
  const f = fixture();
  try {
    await assert.rejects(f.service.browse({ kind: 'playlist', id: 'unknown', offset: 0 }));
    let state = await f.service.browse({ kind: 'playlists', offset: 0 }); assert.equal(state.catalog.playlists.length, 35); assert.equal(state.status, 'signed-out');
    assert.equal(state.catalog.playlists[0]!.trackCount, undefined); // percount 不是歌曲数量。
    const request = { id: state.catalog.playlists[0]!.id, kind: 'playlist' as const, generation: state.generation };
    assert.equal(await f.service.getArtwork(request), image); await f.service.getArtwork(request); assert.equal(f.downloads(), 1);
    state = await f.service.browse({ kind: 'playlist', id: request.id, offset: 0 }); assert.equal(state.catalog.tracks[0]!.id, hash); assert.equal(state.catalog.total, 1);
    state = await f.service.browse({ kind: 'search', query: '合成', searchType: 'songs', offset: 30 });
    assert.equal(state.catalog.tracks[0]!.durationMs, 30000); assert.deepEqual(state.catalog.tracks[0]!.artists, ['合成歌手']);
    assert.equal(f.transport.calls.at(-1)!.data.page, 2);
    state = await f.service.browse({ kind: 'search', query: '合成', searchType: 'playlists', offset: 0 }); assert.equal(state.catalog.playlists[0]!.id, 'collection_1_synthetic');
    assert.equal(JSON.stringify(state).includes('imge.kugou.com'), false);
    await assert.rejects(f.service.resolveTrack(hash, state.generation)); // 匿名浏览不冒充有播放授权。
    f.service.logout(); assert.deepEqual(f.service.snapshot().catalog, initialKugouSnapshot().catalog); await assert.rejects(f.service.getArtwork(request));
  } finally { f.service.dispose(); }
});

test('旧搜索和旧账号迟到响应/图片不回写，缺图与请求失败不伪造封面', async () => {
  const f = fixture(); const late = deferred<unknown>();
  try {
    f.transport.handlers.set('searchSongs', async () => late.promise);
    const old = f.service.browse({ kind: 'search', query: '旧', searchType: 'songs', offset: 0 });
    await f.service.browse({ kind: 'search', query: '新', searchType: 'playlists', offset: 0 });
    late.resolve(ok({ total: 1, lists: [{ FileHash: hash, SongName: '旧数据', Duration: 30 }] })); await old;
    assert.equal(f.service.snapshot().catalog.searchType, 'playlists');
    const accountLate = deferred<unknown>(); f.transport.handlers.set('publicPlaylists', async () => accountLate.promise);
    const pending = f.service.browse({ kind: 'playlists', offset: 0 }); f.service.logout(); accountLate.resolve(ok({ has_next: 0, special_list: [] })); await pending;
    assert.equal(f.service.snapshot().catalog.status, 'idle');
    const imageLate = deferred<string>(); let signal: AbortSignal | undefined;
    const images = new KugouService({ transport: () => new Transport(), artwork: async (_url, _provider, current) => { signal = current; return imageLate.promise; } });
    try {
      await images.browse({ kind: 'playlists', offset: 0 });
      const operation = images.getArtwork({ kind: 'playlist', id: 'collection_0_synthetic', generation: images.snapshot().generation });
      images.logout(); assert.equal(signal?.aborted, true); imageLate.resolve(image); await assert.rejects(operation);
    } finally { images.dispose(); }
  } finally { late.resolve(ok({ lists: [], total: 0 })); f.service.dispose(); }
});

test('搜索曲目沿用原 hash 取链，完整歌单分页准备不取音频，退出使整单准备失效', async () => {
  const f = fixture();
  try {
    await connect(f.service); await f.service.browse({ kind: 'search', query: '合成', searchType: 'songs', offset: 0 });
    const generation = f.service.snapshot().generation;
    assert.equal((await f.service.resolveTrack(hash, generation)).track.id, hash);
    assert.deepEqual(f.transport.calls.filter(call => call.endpoint === 'stream').at(-1)!.data, { hash, freePart: false });
    await f.service.loadPlaylists(); const before = f.transport.calls.filter(call => call.endpoint === 'stream').length;
    f.transport.handlers.set('playlist', async data => ok({ count: 301, info: Array.from({ length: data.page === 1 ? 300 : 1 }, (_, i) => song((i + (data.page === 1 ? 0 : 300)).toString(16).padStart(32, '0'))) }));
    const tracks = await f.service.preparePlaylist('1', 'owned'); assert.equal(tracks.length, 301); assert.equal(f.transport.calls.filter(call => call.endpoint === 'stream').length, before);
    const late = deferred<unknown>(); f.transport.handlers.set('playlist', async () => late.promise);
    const pending = f.service.preparePlaylist('1', 'owned'); f.service.logout(); late.resolve(ok({ count: 1, info: [song()] })); await assert.rejects(pending);
  } finally { f.service.dispose(); }
});

test('搜索/推荐 transport 使用固定标准版端点、路由和分页，不跟随重定向', async () => {
  const original = globalThis.fetch; const transport = new DirectKugouTransport(); const requests: { url: URL; init: RequestInit | undefined }[] = [];
  try {
    globalThis.fetch = async (input, init) => { requests.push({ url: new URL(String(input)), init }); return new Response(JSON.stringify(ok({}))); };
    await transport.call('searchSongs', { query: '合成', page: 2 }, new AbortController().signal);
    assert.equal(requests[0]!.url.pathname, '/v2/search/song'); assert.equal(requests[0]!.url.searchParams.get('pagesize'), '30');
    assert.equal((requests[0]!.init!.headers as Record<string, string>)['x-router'], 'complexsearch.kugou.com'); assert.equal(requests[0]!.init!.redirect, 'error');
    await transport.call('publicPlaylists', { page: 1 }, new AbortController().signal);
    const body = JSON.parse(String(requests[1]!.init!.body)) as Record<string, unknown>; assert.equal(body.appid, 1005); assert.equal(body.page, 1);
  } finally { globalThis.fetch = original; transport.clear(); }
});
