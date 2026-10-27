import { KugouService } from '../packages/providers/src/kugou/service.ts';
import type { KugouCatalogRequest } from '../packages/contracts/src/kugou-catalog.ts';
import { DomainError, normalizeError } from '../packages/contracts/src/errors.ts';

// 显式匿名联网，只报告归一化计数和图片格式结果；不生成二维码、不认证、不输出原始响应。
const service = new KugouService();
const requests: KugouCatalogRequest[] = [
  { kind: 'playlists', offset: 0 }, { kind: 'playlists', offset: 30 },
  { kind: 'search', query: '周杰伦', searchType: 'songs', offset: 0 },
  { kind: 'search', query: '周杰伦', searchType: 'songs', offset: 30 },
  { kind: 'search', query: '轻音乐', searchType: 'playlists', offset: 0 },
];
try {
  for (const request of requests) {
    const state = await service.browse(request);
    if (state.catalog.status !== 'ready') throw new DomainError(state.catalog.error?.code ?? 'unavailable');
    console.log(`酷狗匿名发现通过：${request.kind}${request.kind === 'search' ? `/${request.searchType}` : ''}，偏移 ${request.offset}，曲目 ${state.catalog.tracks.length}，歌单 ${state.catalog.playlists.length}，后续 ${state.catalog.more}。`);
    if (state.catalog.tracks.length) console.log(`酷狗匿名歌曲会员标记：VIP ${state.catalog.tracks.filter(track => track.rights?.fee === 'vip').length}，VIP 音质 ${state.catalog.tracks.filter(track => track.rights?.fee === 'vip-quality').length}，未确认 ${state.catalog.tracks.filter(track => track.rights?.fee === 'unknown').length}。`);
    const id = state.catalog.tracks[0]?.id ?? state.catalog.playlists[0]?.id;
    if (!id) throw new Error('invalid-response');
    const kind = state.catalog.tracks.length ? 'track' : 'playlist';
    const image = await service.getArtwork({ id, kind, generation: state.generation });
    if (!image?.startsWith('data:image/')) throw new Error('invalid-response');
    console.log(`酷狗匿名${kind === 'track' ? '曲目' : '歌单'}封面下载及栅格格式校验通过。`);
    if (kind === 'playlist') {
      const detail = await service.browse({ kind: 'playlist', id, offset: 0 });
      if (detail.catalog.status !== 'ready' || !detail.catalog.tracks.length) throw new Error('invalid-response');
      console.log(`酷狗匿名公开歌单详情通过：曲目 ${detail.catalog.tracks.length}，后续 ${detail.catalog.more}。`);
    }
  }
} catch (error: unknown) { console.error(`酷狗匿名发现失败：${normalizeError(error).code}。`); process.exitCode = 1; }
finally { service.dispose(); }
