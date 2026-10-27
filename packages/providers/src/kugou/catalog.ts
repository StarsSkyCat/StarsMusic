import { kugouCatalogPageSize as pageSize, parseKugouCatalog, parseKugouCatalogPlaylist, type KugouCatalog, type KugouCatalogPlaylist, type KugouCatalogRequest } from '../../../contracts/src/kugou-catalog.ts';
import { DomainError } from '../../../contracts/src/errors.ts';
import { record } from '../../../contracts/src/validation.ts';
import { apiId, integerValue, optionalInteger, parseTracks, success, type BackendTrack } from './response.ts';
import type { KugouTransport } from './transport.ts';

export interface BackendPlaylist { playlist: KugouCatalogPlaylist; cover?: string }
function playlist(value: unknown): BackendPlaylist {
  const row = record(value, 'kugou.public.playlist');
  const cover = row.img ?? row.imgurl ?? row.pic;
  const count = row.song_count ?? row.count;
  return { playlist: parseKugouCatalogPlaylist({ id: apiId(row.gid ?? row.global_collection_id), name: row.specialname ?? row.name,
    ...(count === undefined ? {} : { trackCount: integerValue(count, 'kugou.public.count') }) }),
    ...(typeof cover === 'string' && cover ? { cover } : {}) };
}
export async function publicPlaylistPage(id: string, offset: number, limit: number, transport: KugouTransport, signal: AbortSignal): Promise<{ playlist: BackendPlaylist; tracks: BackendTrack[]; received: number; total: number }> {
  const body = success(await transport.call('publicPlaylist', { id, offset, limit }, signal));
  const data = record(body.data, 'kugou.public.detail'); const info = record(data.list_info, 'kugou.public.info');
  if (apiId(info.global_collection_id) !== id) throw new DomainError('invalid-response');
  const items = parseTracks(data.songs);
  if (items.received > limit) throw new DomainError('invalid-response');
  return { playlist: playlist(info), tracks: [...new Map(items.items.map(item => [item.track.id, item])).values()], received: items.received, total: integerValue(data.count, 'kugou.public.total') };
}
export async function fetchKugouCatalog(request: KugouCatalogRequest, previous: KugouCatalog, transport: KugouTransport, signal: AbortSignal): Promise<{ catalog: KugouCatalog; tracks: BackendTrack[]; playlists: BackendPlaylist[] }> {
  const base = { ...previous, kind: request.kind, offset: request.offset, status: 'ready', tracks: [], playlists: [], playlist: undefined, total: 0, more: false, error: undefined };
  if (request.kind === 'playlist') {
    const result = await publicPlaylistPage(request.id, request.offset, pageSize, transport, signal);
    return { catalog: parseKugouCatalog({ ...base, playlist: result.playlist.playlist, tracks: result.tracks.map(item => item.track), total: result.total,
      more: request.offset < 3000 && result.received > 0 && request.offset + result.received < result.total }), tracks: result.tracks, playlists: [result.playlist] };
  }
  const searching = request.kind === 'search';
  const body = success(await transport.call(searching ? request.searchType === 'songs' ? 'searchSongs' : 'searchPlaylists' : 'publicPlaylists',
    { ...(searching ? { query: request.query } : {}), page: request.offset / pageSize + 1 }, signal));
  const data = record(body.data, 'kugou.catalog.data');
  const rows = searching ? data.lists : data.special_list;
  if (!Array.isArray(rows) || rows.length > (searching ? pageSize : 100)) throw new DomainError('invalid-response');
  const total = optionalInteger(data.total, 'kugou.catalog.total') ?? 0;
  const more = request.offset < 3000 && rows.length > 0 && (searching ? request.offset + rows.length < total : integerValue(data.has_next, 'kugou.catalog.more') === 1);
  if (searching && request.searchType === 'songs') {
    const parsed = parseTracks(rows); const tracks = [...new Map(parsed.items.map(item => [item.track.id, item])).values()];
    return { catalog: parseKugouCatalog({ ...base, query: request.query, searchType: request.searchType, tracks: tracks.map(item => item.track), total, more }), tracks, playlists: [] };
  }
  const parsed = rows.flatMap(value => { try { return [playlist(value)]; } catch { return []; } });
  if (rows.length && !parsed.length) throw new DomainError('invalid-response');
  const playlists = [...new Map(parsed.map(item => [item.playlist.id, item])).values()];
  return { catalog: parseKugouCatalog({ ...base, ...(searching ? { query: request.query, searchType: request.searchType } : {}), playlists: playlists.map(item => item.playlist), total, more }), tracks: [], playlists };
}
