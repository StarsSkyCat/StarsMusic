import assert from 'node:assert/strict';
import test from 'node:test';
import { initialKugouSnapshot, kugouChannels, parseKugouArguments, parseKugouSnapshot } from '../../packages/contracts/src/kugou.ts';
import { parseKugouCatalog } from '../../packages/contracts/src/kugou-catalog.ts';
import { standardBenefits, trackRights, unionBenefits } from '../../packages/providers/src/kugou/rights.ts';
import { parseTracks } from '../../packages/providers/src/kugou/response.ts';
import { KugouService } from '../../packages/providers/src/kugou/service.ts';
import { DirectKugouTransport, type KugouTransport, type KugouEndpoint } from '../../packages/providers/src/kugou/transport.ts';
import { DomainError } from '../../packages/contracts/src/errors.ts';

const hash = 'a'.repeat(32);
const now = Date.parse('2026-10-27T12:00:00+08:00');
const ok = (data: unknown) => ({ status: 1, error_code: 0, data });
const product = (product_type: string, extra = {}) => ({ product_type, is_vip: 1, vip_begin_time: '2026-10-26 00:00:00', vip_end_time: '2026-10-28 00:00:00', ...extra });
const song = { hash, name: '合成会员歌曲', duration: 30, trans_param: { musicpack_advance: 1 } };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
class Transport implements KugouTransport {
  handlers = new Map<KugouEndpoint, () => Promise<unknown>>();
  calls: KugouEndpoint[] = [];
  acceptIdentity() {} exportSession() { return undefined; } restoreSession() {} clear() {}
  async call(endpoint: KugouEndpoint): Promise<unknown> {
    this.calls.push(endpoint); const handler = this.handlers.get(endpoint); if (handler) return handler();
    if (endpoint === 'register') return ok({});
    if (endpoint === 'qrKey') return ok({ qrcode: 'synthetic' });
    if (endpoint === 'qrPoll') return ok({ status: 4, userid: '42', token: 'synthetic' });
    if (endpoint === 'account') return ok({ userid: '42', nickname: '合成账号', vip_type: 1 });
    if (endpoint === 'membership') return ok({ userid: '42', vip_type: 0, busi_vip: [product('tvip')] });
    if (endpoint === 'playlists') return ok({ info: [{ listid: 1, name: '合成歌单', count: 1 }] });
    if (endpoint === 'playlist') return ok({ count: 1, info: [song] });
    if (endpoint === 'searchSongs') return ok({ total: 1, lists: [{ ...song, FileHash: hash, SongName: song.name }] });
    if (endpoint === 'verifyPlayback' || endpoint === 'authorizePlayback' || endpoint === 'authorizedStream') return { status: 0 };
    return { status: 1, hash, url: ['https://fsandroid.kugou.com/synthetic'], priv_status: 0 };
  }
}
function fixture() { const transport = new Transport(); const service = new KugouService({ transport: () => transport, now: () => now, autoPoll: false, encodeQr: async () => 'data:image/png;base64,c3ludGhldGlj' }); return { transport, service }; }
async function connect(service: KugouService) { await service.startLogin(); await service.pollOnce(); await service.refreshMembership(); }

test('酷狗播放会员标记不从下载价格或高音质收费推断，列表/搜索权限通过契约白名单', () => {
  assert.equal(trackRights({ trans_param: { musicpack_advance: '1' } }).fee, 'vip');
  assert.equal(trackRights({ PayType: 3, SQPrivilege: 10, Privilege: 0 }).fee, 'vip-quality');
  assert.equal(trackRights({ PayType: 3 }).fee, 'unknown');
  assert.equal(trackRights({ trans_param: { musicpack_advance: 1, free_limited: 1 } }).fee, 'none');
  assert.equal(trackRights({ trans_param: { musicpack_advance: 0 }, Privilege: 10 }).fee, 'none');
  const track = parseTracks([song]).items[0]!.track;
  assert.equal(track.rights?.fee, 'vip');
  const catalog = parseKugouCatalog({ ...initialKugouSnapshot().catalog, tracks: [track] });
  assert.equal(catalog.tracks[0]!.rights?.fee, 'vip');
  assert.deepEqual(parseKugouArguments(kugouChannels.refreshMembership, []), {});
  assert.throws(() => parseKugouArguments(kugouChannels.refreshMembership, ['42']));
  const state = parseKugouSnapshot({ ...initialKugouSnapshot(), status: 'connected', account: { id: '42', nickname: '合成' }, tracks: [track], membership: { status: 'ready', benefits: [{ kind: 'standard', token: 'private' }], token: 'private' } });
  assert.equal(JSON.stringify(state).includes('private'), false);
  assert.deepEqual(parseKugouSnapshot({ ...state, status: 'signed-out' }).membership.benefits, []);
});

test('酷狗独立会员套餐读取所有权益，过滤失效/未开始，不凭顶层 vip_type 取消有效套餐', () => {
  assert.equal(standardBenefits({ userid: '42', vip_type: '1' }, '42', now)[0]?.kind, 'standard');
  assert.deepEqual(standardBenefits({ vip_type: 1, vip_end_time: '2026-10-26 00:00:00' }, '42', now), []);
  assert.throws(() => standardBenefits({}, '42', now));
  const benefits = unionBenefits(ok({ userid: '42', is_vip: 0, vip_type: 0, busi_vip: [
    product('svip', { is_vip: 0 }), product('tvip'), product('qvip'), product('dvip', { vip_end_time: '2026-10-26 00:00:00' }),
    product('svip', { vip_begin_time: '2026-10-28 00:00:00' }), product('other', { vip_end_time: '' }),
  ] }), '42', now);
  assert.deepEqual(benefits.map(b => b.kind), ['tvip', 'qvip', 'other']);
  assert.equal(benefits[0]!.expiresAt, Date.parse('2026-10-28T00:00:00+08:00'));
  assert.equal(benefits[2]!.expiresAt, undefined);
  for (const data of [{ userid: '99', busi_vip: [] }, {}, { busi_vip: [product('svip', { vip_end_time: '2026-02-30 00:00:00' })] }, { busi_vip: [product('svip', { is_vip: 'unexpected' })] }]) assert.throws(() => unionBenefits(ok(data), '42', now));
});

test('登录自动同步、手动去重，部分失败保留已确认权益，退出丢弃迟到同步', async () => {
  const { service, transport } = fixture();
  try {
    await connect(service); assert.equal(service.snapshot().membership.status, 'ready');
    assert.deepEqual(service.snapshot().membership.benefits.map(b => b.kind), ['standard', 'tvip']);
    transport.handlers.set('membership', async () => { throw new DomainError('network'); });
    await service.refreshMembership(); assert.equal(service.snapshot().status, 'connected');
    assert.equal(service.snapshot().membership.status, 'error'); assert.equal(service.snapshot().membership.benefits[0]!.kind, 'standard');
    const late = deferred<unknown>(); transport.handlers.set('membership', () => late.promise);
    const a = service.refreshMembership(); const b = service.refreshMembership(); assert.equal(a, b);
    service.logout(); late.resolve(ok({ busi_vip: [product('svip')] })); await a;
    assert.equal(service.snapshot().membership.status, 'idle'); assert.equal(service.snapshot().account, undefined);
    assert.throws(() => service.refreshMembership());
  } finally { service.dispose(); }
});

test('酷狗取链实际完整/试听状态投影到私人列表与搜索，错误不提升权限', async () => {
  const { service, transport } = fixture();
  try {
    await connect(service); await service.loadPlaylists(); await service.loadPlaylist('1', 0); await service.browse({ kind: 'search', query: '合成', searchType: 'songs', offset: 0 });
    await service.resolveTrack(hash, service.snapshot().generation);
    assert.equal(service.snapshot().tracks[0]!.rights?.playback, 'full'); assert.equal(service.snapshot().catalog.tracks[0]!.rights?.playback, 'full');
    transport.handlers.set('stream', async () => ({ status: 1, hash, url: ['https://fsandroid.kugou.com/synthetic'], priv_status: 1, free_part_start: 1000, free_part_end: 31000 }));
    await service.resolveTrack(hash, service.snapshot().generation); assert.equal(service.snapshot().tracks[0]!.rights?.playback, 'preview');
    transport.handlers.set('stream', async () => { throw new DomainError('permission-denied'); });
    await assert.rejects(service.resolveTrack(hash, service.snapshot().generation)); assert.equal(service.snapshot().catalog.tracks[0]!.rights?.playback, 'unavailable');
  } finally { service.dispose(); }
});

test('会员端点固定 HTTPS/标准版签名和套餐集合，不发送第三方任意请求', async () => {
  const original = globalThis.fetch; const transport = new DirectKugouTransport();
  try {
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input)); assert.equal(url.origin + url.pathname, 'https://kugouvip.kugou.com/v1/get_union_vip');
      assert.equal(url.searchParams.get('appid'), '1005'); assert.equal(url.searchParams.get('busi_type'), 'concept'); assert.equal(url.searchParams.get('opt_product_types'), 'dvip,qvip');
      assert.equal(init?.redirect, 'error'); return new Response(JSON.stringify(ok({ busi_vip: [] })));
    };
    await transport.call('membership', {}, new AbortController().signal);
  } finally { globalThis.fetch = original; transport.clear(); }
});
