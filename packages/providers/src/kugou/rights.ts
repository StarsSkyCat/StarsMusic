import { DomainError } from '../../../contracts/src/errors.ts';
import type { KugouMembership, KugouTrackRights } from '../../../contracts/src/kugou-rights.ts';
import { record } from '../../../contracts/src/validation.ts';
import { integerValue, numericId, success } from './response.ts';

function flag(value: unknown): number | undefined {
  return value === undefined || value === null ? undefined : integerValue(value, 'kugou.rights.flag');
}
export function trackRights(raw: Record<string, unknown>): KugouTrackRights {
  const extra = raw.trans_param == null ? {} : record(raw.trans_param, 'kugou.rights.extra');
  const limitedFree = flag(extra.free_limited) === 1;
  const musicPackage = flag(extra.musicpack_advance);
  const standard = flag(raw.Privilege ?? raw.privilege);
  // 下载价格/高音质收费不能代替标准音质的播放会员标记。
  const premiumQuality = [raw.HQPrivilege, raw.SQPrivilege, raw['320privilege'], raw.sqprivilege].some(value => flag(value) === 10);
  const fee = limitedFree ? 'none' : musicPackage === 1 ? 'vip'
    : musicPackage === 0 || standard === 0 ? (premiumQuality ? 'vip-quality' : 'none') : 'unknown';
  return { fee, playback: 'unknown' };
}

// 酷狗 union_vip 的无时区日期按中国业务时间解释，避免受 Linux 本地时区影响。
function instant(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '' || value === 0 || value === '0') return undefined;
  if (typeof value === 'number' || (typeof value === 'string' && /^\d{10,13}$/.test(value))) {
    const n = integerValue(value, 'kugou.membership.time');
    const ms = n < 1_000_000_000_000 ? n * 1000 : n;
    if (ms <= 0 || ms > 8_640_000_000_000_000) throw new DomainError('invalid-response');
    return ms;
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) throw new DomainError('invalid-response');
  const ms = Date.parse(value.replace(' ', 'T') + '+08:00');
  if (!Number.isFinite(ms) || ms < 0 || new Date(ms + 8 * 3600000).toISOString().slice(0, 19) !== value.replace(' ', 'T')) throw new DomainError('invalid-response');
  return ms;
}
function owner(data: Record<string, unknown>, accountId: string): void {
  for (const id of [data.userid, data.user_id, data.uid]) if (id !== undefined && numericId(id) !== accountId) throw new DomainError('invalid-response');
}
export function standardBenefits(value: unknown, accountId: string, now: number): KugouMembership['benefits'] {
  const data = record(value, 'kugou.membership.profile'); owner(data, accountId);
  const vip = flag(data.vip_type);
  if (vip === undefined) throw new DomainError('invalid-response');
  if (vip === 0) return [];
  const expiresAt = instant(data.vip_end_time); const startsAt = instant(data.vip_begin_time);
  if ((expiresAt !== undefined && expiresAt <= now) || (startsAt !== undefined && startsAt > now)) return [];
  // The pinned upstream documents vip_type=6 as Super VIP. Product code
  // "svip" in busi_vip means concept VIP and must not be confused with it.
  return [{ kind: vip === 6 ? 'super' : 'standard', ...(expiresAt === undefined ? {} : { expiresAt }), ...(startsAt === undefined ? {} : { startsAt }) }];
}
export function unionBenefits(value: unknown, accountId: string, now: number): KugouMembership['benefits'] {
  const data = record(success(value).data, 'kugou.membership.union'); owner(data, accountId);
  // Standard VIP is also reported at the top level. Some valid responses have
  // no independent products at all; requiring busi_vip used to discard them.
  const hasStandard = data.vip_type !== undefined && data.vip_type !== null;
  const standard = hasStandard ? standardBenefits(data, accountId, now) : [];
  if (data.busi_vip == null && hasStandard) return standard;
  if (!Array.isArray(data.busi_vip) || data.busi_vip.length > 16) throw new DomainError('invalid-response');
  return [...standard, ...data.busi_vip.flatMap(value => {
    const item = record(value, 'kugou.membership.product'); owner(item, accountId);
    const active = typeof item.is_vip === 'boolean' ? Number(item.is_vip) : flag(item.is_vip);
    if (active !== 0 && active !== 1) throw new DomainError('invalid-response');
    if (active === 0) return [];
    const expiresAt = instant(item.vip_end_time); const startsAt = instant(item.vip_begin_time);
    if ((expiresAt !== undefined && expiresAt <= now) || (startsAt !== undefined && startsAt > now)) return [];
    const kind: KugouMembership['benefits'][number]['kind'] = ['svip', 'tvip', 'qvip', 'dvip'].includes(String(item.product_type)) ? item.product_type as 'svip' | 'tvip' | 'qvip' | 'dvip' : 'other';
    return [{ kind, ...(expiresAt === undefined ? {} : { expiresAt }), ...(startsAt === undefined ? {} : { startsAt }) }];
  })];
}
