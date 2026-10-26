import { DomainError } from '../../../contracts/src/errors.ts';
import { neteaseId, type NeteaseTrack } from '../../../contracts/src/netease.ts';
import { nonNegativeInteger, record, text } from '../../../contracts/src/validation.ts';

export function apiId(value: unknown): string {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  return neteaseId(value);
}
export function success(value: unknown): Record<string, unknown> {
  const body = record(value, 'netease.response');
  if (body.code === 301 || body.code === 302) throw new DomainError('session-expired');
  if (body.code === 403) throw new DomainError('permission-denied');
  if (body.code === 429) throw new DomainError('rate-limited');
  if (body.code !== 200) throw new DomainError('unavailable');
  return body;
}
export function parseTracks(value: unknown): NeteaseTrack[] {
  if (!Array.isArray(value)) throw new DomainError('invalid-response');
  return value.map((item: unknown) => {
    const raw = record(item, 'netease.song');
    const artists = raw.ar ?? raw.artists;
    if (!Array.isArray(artists)) throw new DomainError('invalid-response');
    return {
      id: apiId(raw.id), name: text(raw.name, 'netease.name'),
      artists: artists.map((artist: unknown) => text(record(artist, 'netease.artist').name, 'netease.artist.name')),
      durationMs: nonNegativeInteger(raw.dt ?? raw.duration, 'netease.duration'),
    };
  });
}
