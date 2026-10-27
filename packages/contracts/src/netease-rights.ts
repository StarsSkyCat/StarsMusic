import { parseAppError, type AppError } from './errors.ts';
import { choice, ContractValidationError, nonNegativeInteger, record } from './validation.ts';

export interface NeteaseTrackRights {
  readonly fee: 'unknown' | 'none' | 'vip' | 'album' | 'vip-quality';
  readonly playback: 'unknown' | 'full' | 'preview' | 'unavailable';
  readonly maxBitrate?: number;
}
export function parseNeteaseTrackRights(value: unknown): NeteaseTrackRights {
  const raw = record(value, 'netease.rights');
  const maxBitrate = raw.maxBitrate === undefined ? undefined : nonNegativeInteger(raw.maxBitrate, 'netease.rights.bitrate');
  if (maxBitrate !== undefined && maxBitrate > 100_000_000) throw new ContractValidationError('netease.rights.bitrate');
  return Object.freeze({ fee: choice(raw.fee, ['unknown', 'none', 'vip', 'album', 'vip-quality'], 'netease.rights.fee'), playback: choice(raw.playback, ['unknown', 'full', 'preview', 'unavailable'], 'netease.rights.playback'), ...(maxBitrate === undefined ? {} : { maxBitrate }) });
}
export interface NeteaseMembership {
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly benefits: readonly { readonly kind: 'vip' | 'svip' | 'music-package' | 'album'; readonly expiresAt?: number }[];
  readonly syncedAt?: number;
  readonly error?: AppError;
}
export function parseNeteaseMembership(value: unknown): NeteaseMembership {
  const raw = record(value, 'netease.membership');
  if (!Array.isArray(raw.benefits) || raw.benefits.length > 4) throw new ContractValidationError('netease.membership.benefits');
  return Object.freeze({ status: choice(raw.status, ['idle', 'loading', 'ready', 'error'], 'netease.membership.status'), benefits: Object.freeze(raw.benefits.map(value => {
    const item = record(value, 'netease.membership.benefit');
    return Object.freeze({ kind: choice(item.kind, ['vip', 'svip', 'music-package', 'album'], 'netease.membership.kind'), ...(item.expiresAt === undefined ? {} : { expiresAt: nonNegativeInteger(item.expiresAt, 'netease.membership.expiresAt') }) });
  })), ...(raw.syncedAt === undefined ? {} : { syncedAt: nonNegativeInteger(raw.syncedAt, 'netease.membership.syncedAt') }), ...(raw.error === undefined ? {} : { error: parseAppError(raw.error) }) });
}
export const initialNeteaseMembership = (): NeteaseMembership => parseNeteaseMembership({ status: 'idle', benefits: [] });
