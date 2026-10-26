import { DirectNeteaseTransport } from '../packages/providers/src/netease/transport.ts';
import { fetchCatalog } from '../packages/providers/src/netease/catalog.ts';
import { initialCatalog, type CatalogRequest } from '../packages/contracts/src/netease-catalog.ts';
import { normalizeError } from '../packages/contracts/src/errors.ts';

// 显式匿名联网验证，仅输出归一化计数，不输出 Cookie、二维码、地址或响应原文。
const requests: CatalogRequest[] = [
  { kind: 'hot', category: '全部', order: 'hot', offset: 0 },
  { kind: 'hot', category: '全部', order: 'hot', offset: 30 },
  { kind: 'playlists', category: '全部', order: 'hot', offset: 0 },
  { kind: 'search', query: '周杰伦', searchType: 'songs', offset: 0 },
  { kind: 'search', query: '轻音乐', searchType: 'playlists', offset: 0 },
];
for (const request of requests) {
  const transport = new DirectNeteaseTransport();
  try {
    const result = await fetchCatalog(request, initialCatalog(), new Map(), transport, AbortSignal.timeout(15000));
    console.log(`匿名发现通过：${request.kind}${request.kind === 'search' ? `/${request.searchType}` : ''}，偏移 ${request.offset}，曲目 ${result.catalog.tracks.length}，歌单 ${result.catalog.playlists.length}，后续 ${result.catalog.more}。`);
    if (request.kind === 'playlists' && result.catalog.playlists[0]) {
      const selected = result.catalog.playlists[0];
      const detail = await fetchCatalog({ kind: 'playlist', id: selected.id, offset: 0 }, result.catalog, new Map([[selected.id, selected]]), transport, AbortSignal.timeout(15000));
      console.log(`匿名公开歌单详情通过：曲目 ${detail.catalog.tracks.length}，后续 ${detail.catalog.more}。`);
    }
  } catch (error: unknown) {
    console.error(`匿名发现失败：${request.kind}，${normalizeError(error).code}。`); process.exitCode = 1;
  } finally { transport.clear(); }
}
