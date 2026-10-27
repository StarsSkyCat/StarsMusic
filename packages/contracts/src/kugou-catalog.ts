import { parseKugouTrackRights, type KugouTrackRights } from './kugou-rights.ts';
import { parseAppError, type AppError } from './errors.ts';
import { choice, ContractValidationError, nonNegativeInteger, record, text } from './validation.ts';

export const kugouCatalogPageSize = 30;
export interface KugouCatalogTrack { readonly id: string; readonly name: string; readonly artists: readonly string[]; readonly durationMs: number; readonly rights?: KugouTrackRights }
export interface KugouCatalogPlaylist { readonly id: string; readonly name: string; readonly trackCount?: number }
export interface KugouCatalog {
  readonly kind: 'playlists' | 'search' | 'playlist'; readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly query: string; readonly searchType: 'songs' | 'playlists'; readonly offset: number;
  readonly more: boolean; readonly total: number; readonly tracks: readonly KugouCatalogTrack[];
  readonly playlists: readonly KugouCatalogPlaylist[]; readonly playlist?: KugouCatalogPlaylist; readonly error?: AppError;
}
export type KugouCatalogRequest = { kind: 'playlists'; offset: number }
  | { kind: 'search'; query: string; searchType: 'songs' | 'playlists'; offset: number }
  | { kind: 'playlist'; id: string; offset: number };
export function kugouCatalogId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new ContractValidationError('kugou.catalog.id');
  return value;
}
export function kugouHash(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{32}$/.test(value)) throw new ContractValidationError('kugou.hash');
  return value;
}
function offset(value: unknown): number {
  const n = nonNegativeInteger(value, 'kugou.catalog.offset');
  if (n > 3000 || n % kugouCatalogPageSize !== 0) throw new ContractValidationError('kugou.catalog.offset');
  return n;
}
function query(value: unknown): string {
  const raw = text(value, 'kugou.search.query');
  if (!raw.trim() || raw.trim().length > 100 || /[\u0000-\u001f\u007f]/.test(raw)) throw new ContractValidationError('kugou.search.query');
  return raw.trim();
}
export function parseKugouCatalogRequest(value: unknown): KugouCatalogRequest {
  const raw = record(value, 'kugou.catalog.request');
  const kind = choice(raw.kind, ['playlists', 'search', 'playlist'], 'kugou.catalog.kind');
  const keys = kind === 'search' ? ['kind', 'query', 'searchType', 'offset'] : kind === 'playlist' ? ['kind', 'id', 'offset'] : ['kind', 'offset'];
  if (Object.keys(raw).some(key => !keys.includes(key))) throw new ContractValidationError('kugou.catalog.request');
  if (kind === 'search') return { kind, query: query(raw.query), searchType: choice(raw.searchType, ['songs', 'playlists'], 'kugou.search.type'), offset: offset(raw.offset) };
  if (kind === 'playlist') return { kind, id: kugouCatalogId(raw.id), offset: offset(raw.offset) };
  return { kind, offset: offset(raw.offset) };
}
export function parseKugouCatalogPlaylist(value: unknown): KugouCatalogPlaylist {
  const raw = record(value, 'kugou.catalog.playlist'); const name = text(raw.name, 'kugou.playlist.name');
  if (name.length > 500) throw new ContractValidationError('kugou.playlist.name');
  return Object.freeze({ id: kugouCatalogId(raw.id), name, ...(raw.trackCount === undefined ? {} : { trackCount: nonNegativeInteger(raw.trackCount, 'kugou.playlist.count') }) });
}
export function parseKugouCatalog(value: unknown): KugouCatalog {
  const raw = record(value, 'kugou.catalog');
  // 推荐响应可能附加额外推荐卡（实测请求 30 返回 35）；全部展示，不按请求条数截断。
  if (!Array.isArray(raw.tracks) || raw.tracks.length > 30 || !Array.isArray(raw.playlists) || raw.playlists.length > 100 || typeof raw.more !== 'boolean') throw new ContractValidationError('kugou.catalog.lists');
  return Object.freeze({ kind: choice(raw.kind, ['playlists', 'search', 'playlist'], 'kugou.catalog.kind'), status: choice(raw.status, ['idle', 'loading', 'ready', 'error'], 'kugou.catalog.status'),
    query: raw.query === '' ? '' : query(raw.query), searchType: choice(raw.searchType, ['songs', 'playlists'], 'kugou.search.type'), offset: offset(raw.offset),
    more: raw.more, total: nonNegativeInteger(raw.total, 'kugou.catalog.total'), playlists: Object.freeze(raw.playlists.map(parseKugouCatalogPlaylist)),
    tracks: Object.freeze(raw.tracks.map((value: unknown) => {
      const row = record(value, 'kugou.catalog.track'); const name = text(row.name, 'kugou.track.name');
      if (name.length > 500 || !Array.isArray(row.artists) || row.artists.length > 100) throw new ContractValidationError('kugou.catalog.track');
      return Object.freeze({ id: kugouHash(row.id), name, artists: Object.freeze(row.artists.map(value => {
        const artist = text(value, 'kugou.artist'); if (artist.length > 500) throw new ContractValidationError('kugou.artist'); return artist;
      })), durationMs: nonNegativeInteger(row.durationMs, 'kugou.duration'), ...(row.rights === undefined ? {} : { rights: parseKugouTrackRights(row.rights) }) });
    })), ...(raw.playlist === undefined ? {} : { playlist: parseKugouCatalogPlaylist(raw.playlist) }), ...(raw.error === undefined ? {} : { error: parseAppError(raw.error) }) });
}
export function initialKugouCatalog(): KugouCatalog {
  return parseKugouCatalog({ kind: 'playlists', status: 'idle', query: '', searchType: 'songs', offset: 0, more: false, total: 0, tracks: [], playlists: [] });
}
export function parseKugouQueue(value: unknown): readonly KugouCatalogTrack[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10000) throw new ContractValidationError('kugou.queue');
  const tracks: KugouCatalogTrack[] = [];
  for (let i = 0; i < value.length; i += kugouCatalogPageSize) tracks.push(...parseKugouCatalog({ ...initialKugouCatalog(), tracks: value.slice(i, i + kugouCatalogPageSize) }).tracks);
  if (new Set(tracks.map(track => track.id)).size !== tracks.length) throw new ContractValidationError('kugou.queue');
  return Object.freeze(tracks);
}
