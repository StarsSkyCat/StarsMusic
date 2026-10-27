import type { NeteasePlaylist } from '../../../contracts/src/netease.ts';
import { DomainError } from '../../../contracts/src/errors.ts';
import { nonNegativeInteger, record, text } from '../../../contracts/src/validation.ts';
import { apiId } from './response.ts';
export function playlistOwner(raw: Record<string, unknown>): string | undefined {
  const creator = raw.creator == null ? undefined : record(raw.creator, 'netease.playlist.creator');
  const owner = creator?.userId === undefined ? undefined : apiId(creator.userId);
  const userId = raw.userId === undefined ? undefined : apiId(raw.userId);
  if (owner && userId && owner !== userId) throw new DomainError('invalid-response');
  return owner ?? userId;
}
export function ownedPlaylist(value: unknown, accountId: string): NeteasePlaylist {
  const raw = record(value, 'netease.playlist'); const owner = playlistOwner(raw);
  return { id: apiId(raw.id), name: text(raw.name, 'netease.playlist.name'), trackCount: nonNegativeInteger(raw.trackCount, 'netease.playlist.count'), editable: owner === accountId, likedSongs: owner === accountId && raw.specialType === 5, subscribed: owner !== undefined && owner !== accountId };
}
export function playlistTrackIds(value: unknown, expected: string): { raw: Record<string, unknown>; ids: string[] } {
  const raw = record(value, 'netease.playlist');
  if (apiId(raw.id) !== expected || !Array.isArray(raw.trackIds) || raw.trackIds.length > 10000) throw new DomainError('invalid-response');
  return { raw, ids: raw.trackIds.map(value => apiId(record(value, 'netease.playlist.trackId').id)) };
}
