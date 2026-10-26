import { parseAppError, type AppError } from './errors.ts';
import { choice, ContractValidationError, nonNegativeInteger, record, text } from './validation.ts';

export const catalogPageSize = 30;
export const neteaseCategories = ['全部', '华语', '欧美', '日语', '韩语', '流行', '摇滚', '民谣', '电子', '轻音乐', '古风', 'ACG'] as const;
export type NeteaseCategory = typeof neteaseCategories[number];
export interface CatalogTrack { readonly id: string; readonly name: string; readonly artists: readonly string[]; readonly durationMs: number }
export interface CatalogPlaylist { readonly id: string; readonly name: string; readonly trackCount: number }
export interface NeteaseCatalog {
  readonly kind: 'hot' | 'playlists' | 'search' | 'playlist';
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly query: string;
  readonly searchType: 'songs' | 'playlists';
  readonly category: NeteaseCategory;
  readonly order: 'hot' | 'new';
  readonly offset: number;
  readonly more: boolean;
  readonly total: number;
  readonly tracks: readonly CatalogTrack[];
  readonly playlists: readonly CatalogPlaylist[];
  readonly playlist?: CatalogPlaylist;
  readonly error?: AppError;
}
export type CatalogRequest =
  | { kind: 'hot' | 'playlists'; category: NeteaseCategory; order: 'hot' | 'new'; offset: number }
  | { kind: 'search'; query: string; searchType: 'songs' | 'playlists'; offset: number }
  | { kind: 'playlist'; id: string; offset: number };

export function catalogId(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{1,30}$/.test(value)) throw new ContractValidationError('netease.id');
  return value;
}
export function catalogOffset(value: unknown): number {
  const offset = nonNegativeInteger(value, 'netease.catalog.offset');
  if (offset > 3000 || offset % catalogPageSize !== 0) throw new ContractValidationError('netease.catalog.offset');
  return offset;
}
export function searchQuery(value: unknown): string {
  const raw = text(value, 'netease.search.query');
  const query = raw.trim();
  if (query.length > 100 || /[\u0000-\u001f\u007f]/.test(raw)) throw new ContractValidationError('netease.search.query');
  return query;
}
export function parseCatalogRequest(value: unknown): CatalogRequest {
  const input = record(value, 'netease.catalog.request');
  const kind = choice(input.kind, ['hot', 'playlists', 'search', 'playlist'], 'netease.catalog.kind');
  const keys = kind === 'search' ? ['kind', 'query', 'searchType', 'offset'] : kind === 'playlist' ? ['kind', 'id', 'offset'] : ['kind', 'category', 'order', 'offset'];
  if (Object.keys(input).some(key => !keys.includes(key))) throw new ContractValidationError('netease.catalog.request');
  const offset = catalogOffset(input.offset);
  if (kind === 'search') return { kind, offset, query: searchQuery(input.query), searchType: choice(input.searchType, ['songs', 'playlists'], 'netease.search.type') };
  if (kind === 'playlist') return { kind, offset, id: catalogId(input.id) };
  return { kind, offset, category: choice(input.category, neteaseCategories, 'netease.category'), order: choice(input.order, ['hot', 'new'], 'netease.order') };
}
export function parseCatalogPlaylist(value: unknown): CatalogPlaylist {
  const item = record(value, 'netease.catalog.playlist');
  const name = text(item.name, 'netease.catalog.name');
  if (name.length > 500) throw new ContractValidationError('netease.catalog.name');
  return Object.freeze({ id: catalogId(item.id), name, trackCount: nonNegativeInteger(item.trackCount, 'netease.catalog.count') });
}
export function parseCatalog(value: unknown): NeteaseCatalog {
  const input = record(value, 'netease.catalog');
  if (!Array.isArray(input.tracks) || !Array.isArray(input.playlists) || input.tracks.length > catalogPageSize || input.playlists.length > catalogPageSize || typeof input.more !== 'boolean') throw new ContractValidationError('netease.catalog.lists');
  const query = typeof input.query === 'string' && input.query === '' ? '' : searchQuery(input.query);
  return Object.freeze({
    kind: choice(input.kind, ['hot', 'playlists', 'search', 'playlist'], 'netease.catalog.kind'),
    status: choice(input.status, ['idle', 'loading', 'ready', 'error'], 'netease.catalog.status'),
    query, searchType: choice(input.searchType, ['songs', 'playlists'], 'netease.search.type'),
    category: choice(input.category, neteaseCategories, 'netease.category'), order: choice(input.order, ['hot', 'new'], 'netease.order'),
    offset: catalogOffset(input.offset), more: input.more, total: nonNegativeInteger(input.total, 'netease.catalog.total'),
    playlists: Object.freeze(input.playlists.map(parseCatalogPlaylist)),
    tracks: Object.freeze(input.tracks.map((value: unknown) => {
      const track = record(value, 'netease.catalog.track');
      const name = text(track.name, 'netease.catalog.track.name');
      if (name.length > 500 || !Array.isArray(track.artists) || track.artists.length > 100) throw new ContractValidationError('netease.catalog.track');
      return Object.freeze({ id: catalogId(track.id), name, artists: Object.freeze(track.artists.map(value => {
        const artist = text(value, 'netease.catalog.artist');
        if (artist.length > 500) throw new ContractValidationError('netease.catalog.artist');
        return artist;
      })), durationMs: nonNegativeInteger(track.durationMs, 'netease.catalog.duration') });
    })),
    ...(input.playlist === undefined ? {} : { playlist: parseCatalogPlaylist(input.playlist) }),
    ...(input.error === undefined ? {} : { error: parseAppError(input.error) }),
  });
}
export function initialCatalog(): NeteaseCatalog {
  return parseCatalog({ kind: 'hot', status: 'idle', query: '', searchType: 'songs', category: '全部', order: 'hot', offset: 0, more: false, total: 0, tracks: [], playlists: [] });
}
