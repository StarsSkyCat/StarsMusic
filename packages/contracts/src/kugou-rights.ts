import { parseAppError, type AppError } from './errors.ts';
import { choice, ContractValidationError, nonNegativeInteger, record } from './validation.ts';

export interface KugouTrackRights {
  readonly fee: 'unknown' | 'none' | 'vip' | 'vip-quality';
  readonly playback: 'unknown' | 'full' | 'preview' | 'unavailable';
}
export function parseKugouTrackRights(value: unknown): KugouTrackRights {
  const raw = record(value, 'kugou.rights');
  return Object.freeze({ fee: choice(raw.fee, ['unknown', 'none', 'vip', 'vip-quality'], 'kugou.rights.fee'), playback: choice(raw.playback, ['unknown', 'full', 'preview', 'unavailable'], 'kugou.rights.playback') });
}
export interface KugouMembership {
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly benefits: readonly { readonly kind: 'standard' | 'svip' | 'tvip' | 'qvip' | 'dvip' | 'other'; readonly expiresAt?: number; readonly startsAt?: number }[];
  readonly syncedAt?: number;
  readonly error?: AppError;
}
export function parseKugouMembership(value: unknown): KugouMembership {
  const raw = record(value, 'kugou.membership');
  if (!Array.isArray(raw.benefits) || raw.benefits.length > 17) throw new ContractValidationError('kugou.membership.benefits');
  return Object.freeze({ status: choice(raw.status, ['idle', 'loading', 'ready', 'error'], 'kugou.membership.status'), benefits: Object.freeze(raw.benefits.map(value => {
    const item = record(value, 'kugou.membership.benefit');
    return Object.freeze({ kind: choice(item.kind, ['standard', 'svip', 'tvip', 'qvip', 'dvip', 'other'], 'kugou.membership.kind'),
      ...(item.expiresAt === undefined ? {} : { expiresAt: nonNegativeInteger(item.expiresAt, 'kugou.membership.expiresAt') }),
      ...(item.startsAt === undefined ? {} : { startsAt: nonNegativeInteger(item.startsAt, 'kugou.membership.startsAt') }) });
  })), ...(raw.syncedAt === undefined ? {} : { syncedAt: nonNegativeInteger(raw.syncedAt, 'kugou.membership.syncedAt') }), ...(raw.error === undefined ? {} : { error: parseAppError(raw.error) }) });
}
export const initialKugouMembership = (): KugouMembership => parseKugouMembership({ status: 'idle', benefits: [] });
