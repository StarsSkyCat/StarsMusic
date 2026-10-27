import { catalogPageSize, parseCatalog, parseCatalogPlaylist, type CatalogPlaylist, type CatalogRequest, type NeteaseCatalog } from '../../../contracts/src/netease-catalog.ts';
import { DomainError } from '../../../contracts/src/errors.ts';
import { nonNegativeInteger, record } from '../../../contracts/src/validation.ts';
import { apiId, parseTracks, success } from './response.ts';
import type { NeteaseTransport } from './transport.ts';

function playlist(value: unknown): CatalogPlaylist {
  const row = record(value, 'netease.public.playlist');
  return parseCatalogPlaylist({ id: apiId(row.id), name: row.name, trackCount: row.trackCount });
}
function page(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > catalogPageSize) throw new DomainError('invalid-response');
  return value;
}

export async function fetchCatalog(request: CatalogRequest, previous: NeteaseCatalog, registered: ReadonlyMap<string, CatalogPlaylist>, transport: NeteaseTransport, signal: AbortSignal): Promise<{ catalog: NeteaseCatalog; originals: readonly unknown[]; playlistOriginals?: readonly unknown[] }> {
  const base = { ...previous, kind: request.kind, offset: request.offset, status: 'ready', tracks: [], playlists: [], more: false, total: 0, playlist: undefined, error: undefined };
  if (request.kind === 'search') {
    const body = success(await transport.call('search', { s: request.query, type: request.searchType === 'songs' ? 1 : 1000, limit: catalogPageSize, offset: request.offset, total: true }, signal));
    const result = record(body.result, 'netease.search.result');
    const total = nonNegativeInteger(result[request.searchType === 'songs' ? 'songCount' : 'playlistCount'] ?? 0, 'netease.search.total');
    const items = page(result[request.searchType === 'songs' ? 'songs' : 'playlists'] ?? []);
    const more = items.length > 0 && request.offset + items.length < total && request.offset < 3000;
    return { catalog: parseCatalog({ ...base, query: request.query, searchType: request.searchType, total, more,
      ...(request.searchType === 'songs' ? { tracks: parseTracks(items) } : { playlists: items.map(playlist) }) }), originals: request.searchType === 'songs' ? items : [], playlistOriginals: request.searchType === 'playlists' ? items : [] };
  }
  if (request.kind === 'playlists') {
    const body = success(await transport.call('publicPlaylists', { cat: request.category, order: request.order, limit: catalogPageSize, offset: request.offset, total: true }, signal));
    const items = page(body.playlists);
    if (typeof body.more !== 'boolean') throw new DomainError('invalid-response');
    return { catalog: parseCatalog({ ...base, category: request.category, order: request.order,
      playlists: items.map(playlist), more: body.more && items.length > 0 && request.offset < 3000, total: body.total ?? 0 }), originals: [], playlistOriginals: items };
  }
  let selected: CatalogPlaylist;
  if (request.kind === 'hot') {
    const body = success(await transport.call('toplists', {}, signal));
    if (!Array.isArray(body.list)) throw new DomainError('invalid-response');
    const hot = body.list.find(value => {
      const item = record(value, 'netease.chart');
      return item.name === '云音乐热歌榜' || item.name === '热歌榜';
    });
    if (!hot) throw new DomainError('unavailable');
    selected = playlist(hot);
  } else if (request.kind === 'playlist') {
    const found = registered.get(request.id);
    if (!found) throw new DomainError('invalid-input');
    selected = found;
  } else throw new DomainError('invalid-input');
  const body = success(await transport.call('playlist', { id: selected.id, n: 1000, s: 0 }, signal));
  const detail = record(body.playlist, 'netease.public.playlist');
  if (apiId(detail.id) !== selected.id || !Array.isArray(detail.trackIds)) throw new DomainError('invalid-response');
  const ids = detail.trackIds.slice(request.offset, request.offset + catalogPageSize).map(value => apiId(record(value, 'netease.trackId').id));
  const songs = ids.length ? success(await transport.call('songs', { c: JSON.stringify(ids.map(id => ({ id }))) }, signal)) : { songs: [] };
  const originals = page(songs.songs);
  const tracks = new Map(parseTracks(originals).map(track => [track.id, track]));
  return { catalog: parseCatalog({ ...base, playlist: { ...selected, trackCount: detail.trackIds.length },
    tracks: ids.flatMap(id => tracks.has(id) ? [tracks.get(id)!] : []), total: detail.trackIds.length,
    more: request.offset + ids.length < detail.trackIds.length && ids.length > 0 && request.offset < 3000 }), originals, playlistOriginals: [detail] };
}
