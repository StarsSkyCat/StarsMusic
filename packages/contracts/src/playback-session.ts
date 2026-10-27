import { ContractValidationError, record } from './validation.ts';
import { playbackNumber } from './playback.ts';

// 仅可信后台使用；不经 preload 暴露。白名单不包含凭据、地址或播放权限缓存。
interface StoredTrackBase { id: string; title: string; artist?: string }
export type StoredRemoteTrack = StoredTrackBase & { kind: 'netease' | 'kugou'; sourceId: string; accountId: string; durationMs?: number };
export type StoredPlaybackTrack = (StoredTrackBase & { kind: 'local'; path: string }) | StoredRemoteTrack;
export interface StoredPlaybackSession {
  version: 1; queue: StoredPlaybackTrack[]; currentId: string | null;
  positionSeconds: number; durationSeconds: number; volume: number; muted: boolean; lastAudibleVolume: number;
}
function invalid(): never { throw new ContractValidationError('playback.session'); }
function string(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) invalid();
  return value;
}
function keys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) invalid();
}
export function parseStoredPlaybackTrack(value: unknown): StoredPlaybackTrack {
  const row = record(value, 'playback.session.track');
  const id = string(row.id, 100); if (!/^[\w-]+$/.test(id)) invalid();
  const base = { id, title: string(row.title, 2000), ...(row.artist === undefined ? {} : { artist: string(row.artist, 2000) }) };
  if (row.kind === 'local') {
    keys(row, ['id', 'title', 'artist', 'kind', 'path']);
    const path = string(row.path, 4096);
    if (!/^(?:\/|[A-Za-z]:[\\/])/.test(path) || /[\r\n]/.test(path) || !/\.(?:mp3|flac|wav|m4a|aac|ogg|opus|aif|aiff)$/i.test(path)) invalid();
    return { ...base, kind: 'local', path };
  }
  keys(row, ['id', 'title', 'artist', 'kind', 'sourceId', 'accountId', 'durationMs']);
  if (row.kind !== 'netease' && row.kind !== 'kugou') invalid();
  const sourceId = string(row.sourceId, 100); const accountId = string(row.accountId, 30);
  if (!/^\d{1,30}$/.test(accountId) || !(row.kind === 'netease' ? /^\d{1,30}$/ : /^[a-f0-9]{32}$/).test(sourceId)) invalid();
  return { ...base, kind: row.kind, sourceId, accountId, ...(row.durationMs === undefined ? {} : { durationMs: playbackNumber(row.durationMs, 604800000) }) };
}
export function parseStoredPlaybackSession(value: unknown): StoredPlaybackSession {
  const row = record(value, 'playback.session');
  keys(row, ['version', 'queue', 'currentId', 'positionSeconds', 'durationSeconds', 'volume', 'muted', 'lastAudibleVolume']);
  if (row.version !== 1 || !Array.isArray(row.queue) || row.queue.length > 10000 || typeof row.muted !== 'boolean') invalid();
  const queue = row.queue.map(parseStoredPlaybackTrack);
  const ids = new Set(queue.map(track => track.id));
  if (ids.size !== queue.length || (row.currentId !== null && (typeof row.currentId !== 'string' || !ids.has(row.currentId)))) invalid();
  const lastAudibleVolume = playbackNumber(row.lastAudibleVolume, 100); if (lastAudibleVolume <= 0) invalid();
  return { version: 1, queue, currentId: row.currentId as string | null,
    positionSeconds: playbackNumber(row.positionSeconds, 604800), durationSeconds: playbackNumber(row.durationSeconds, 604800),
    volume: playbackNumber(row.volume, 100), muted: row.muted, lastAudibleVolume };
}
