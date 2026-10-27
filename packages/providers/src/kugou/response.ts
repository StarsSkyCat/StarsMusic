import { DomainError } from '../../../contracts/src/errors.ts';
import { kugouId, type KugouTrack } from '../../../contracts/src/kugou.ts';
import { nonNegativeInteger, record, text } from '../../../contracts/src/validation.ts';

export function apiId(value: unknown): string {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  return kugouId(value);
}
export function success(value: unknown): Record<string, unknown> {
  const body = record(value, 'kugou.response');
  if (body.status !== 1 || (body.error_code !== undefined && body.error_code !== 0)) throw new DomainError('unavailable');
  return body;
}
export interface BackendTrack { track: KugouTrack; hash: string; cover?: string; album?: string }
export function numericId(value: unknown): string {
  const id = apiId(value); if (!/^\d{1,30}$/.test(id)) throw new DomainError('invalid-response'); return id;
}
// 平台不同端点可能把数量/时长作为数字或十进制字符串返回；只接受非负安全整数。
export function integerValue(value: unknown, field: string): number {
  if (typeof value === 'number') return nonNegativeInteger(value, field);
  if (typeof value === 'string' && /^\d{1,15}$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw new DomainError('invalid-response');
}
export function optionalInteger(value: unknown, field: string): number | undefined {
  return value === undefined || value === null || value === '' ? undefined : integerValue(value, field);
}
export function parseTracks(value: unknown): { items: BackendTrack[]; received: number } {
  if (!Array.isArray(value) || value.length > 500) throw new DomainError('invalid-response');
  const items: BackendTrack[] = [];
  for (const entry of value) {
    // 单条损坏不应让整页不可用；仍要求至少有一条可播放曲目。
    try {
      const raw = record(entry, 'kugou.song');
      const hash = text(raw.hash ?? raw.filehash ?? raw.FileHash, 'kugou.hash').toLowerCase();
      if (!/^[a-f0-9]{32}$/.test(hash)) continue;
      const singers = Array.isArray(raw.singerinfo) ? raw.singerinfo
        : Array.isArray(raw.authors) ? raw.authors : Array.isArray(raw.Singers) ? raw.Singers : [];
      const artists = singers.flatMap((value: unknown) => {
        try {
          const singer = record(value, 'kugou.singer');
          return [text(singer.name ?? singer.author_name, 'kugou.singer.name')];
        } catch { return []; }
      });
      const name = text(raw.name ?? raw.filename ?? raw.songname ?? raw.SongName ?? raw.FileName, 'kugou.song.name').replace(/\.(?:mp3|flac|m4a|aac|ogg|wav|ape|opus|aiff?)$/i, '').trim();
      if (!name) continue;
      const timelen = optionalInteger(raw.timelen, 'kugou.timelen');
      const seconds = optionalInteger(raw.duration ?? raw.Duration, 'kugou.duration');
      const durationMs = timelen ?? (seconds === undefined ? 0 : seconds * 1000);
      const album = raw.albuminfo && typeof raw.albuminfo === 'object' ? record(raw.albuminfo, 'kugou.album') : {};
      const trans = raw.trans_param && typeof raw.trans_param === 'object' ? record(raw.trans_param, 'kugou.track.extra') : {};
      const cover = [raw.cover, raw.img, raw.AlbumImage, album.img, album.cover, album.sizable_cover, trans.union_cover].find(value => typeof value === 'string' && value.length > 0);
      items.push({ track: { id: hash, name, artists, durationMs }, hash,
        ...(typeof cover === 'string' && cover ? { cover } : {}),
        ...(typeof (album.name ?? raw.AlbumName) === 'string' ? { album: String(album.name ?? raw.AlbumName).slice(0, 500) } : {}),
      });
    } catch { /* 跳过无法安全解析的单条记录 */ }
  }
  if (value.length > 0 && items.length === 0) throw new DomainError('invalid-response');
  return { items, received: value.length };
}
