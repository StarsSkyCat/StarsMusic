import { parseNeteaseTrackRights, type NeteaseMembership, type NeteaseTrackRights } from '../../../contracts/src/netease-rights.ts';
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
  if ([405, 406, 460].includes(body.code as number)) throw new DomainError('verification-required');
  if (body.code === 429) throw new DomainError('rate-limited');
  if (body.code !== 200) throw new DomainError('unavailable');
  return body;
}
export function parseTracks(value: unknown, privileges?: unknown): NeteaseTrack[] {
  const rights = new Map<string, Record<string, unknown>>();
  if (privileges !== undefined) {
    if (!Array.isArray(privileges)) throw new DomainError('invalid-response');
    for (const item of privileges) {
      const raw = record(item, 'netease.privilege'); const id = apiId(raw.id);
      if (rights.has(id)) throw new DomainError('invalid-response');
      rights.set(id, raw);
    }
  }
  if (!Array.isArray(value)) throw new DomainError('invalid-response');
  return value.map((item: unknown) => {
    const raw = record(item, 'netease.song');
    const artists = raw.ar ?? raw.artists;
    if (!Array.isArray(artists)) throw new DomainError('invalid-response');
    const id = apiId(raw.id);
    const privilege = rights.get(id) ?? (raw.privilege == null ? undefined : record(raw.privilege, 'netease.privilege'));
    if (privilege?.id !== undefined && apiId(privilege.id) !== id) throw new DomainError('invalid-response');
    const billing = raw.fee ?? privilege?.fee;
    const fee: NeteaseTrackRights['fee'] = billing === 0 ? 'none' : billing === 1 ? 'vip' : billing === 4 ? 'album' : billing === 8 ? 'vip-quality' : 'unknown';
    const maxBitrate = privilege?.pl;
    const access = raw.fee === undefined && !privilege ? undefined : parseNeteaseTrackRights({ fee, playback: typeof privilege?.st === 'number' && Number.isSafeInteger(privilege.st) && privilege.st < 0 ? 'unavailable' : 'unknown', ...(typeof maxBitrate === 'number' && Number.isSafeInteger(maxBitrate) && maxBitrate >= 0 && maxBitrate <= 100_000_000 ? { maxBitrate } : {}) });
    return {
      id, name: text(raw.name, 'netease.name'),
      artists: artists.map((artist: unknown) => text(record(artist, 'netease.artist').name, 'netease.artist.name')),
      durationMs: nonNegativeInteger(raw.dt ?? raw.duration, 'netease.duration'),
      ...(access ? { rights: access } : {}),
    };
  });
}

// 会员状态来自专用接口；等级/昵称都不能代替有效期限或单曲授权。
export function parseMembershipResponse(value: unknown, accountId: string, now: number): NeteaseMembership {
  const body = success(value);
  const wrapper = record(body.data, 'netease.vip.data');
  const data = wrapper.vipInfo === undefined ? wrapper : record(wrapper.vipInfo, 'netease.vip.info');
  // 已由后台固定为当前账号的请求；返回账号时必须匹配，省略账号不是其他账号。
  for (const owner of [wrapper.userId, data.userId]) if (owner !== undefined && apiId(owner) !== accountId) throw new DomainError('invalid-response');
  const integer = (value: unknown): number | undefined => {
    const parsed = typeof value === 'string' && /^\d{1,16}$/.test(value) ? Number(value) : value;
    return typeof parsed === 'number' && Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
  };
  const kinds = { associator: 'vip', redplus: 'svip', musicPackage: 'music-package', albumVip: 'album' } as const;
  const benefits: NeteaseMembership['benefits'][number][] = [];
  let recognized = false;
  for (const [key, kind] of Object.entries(kinds)) {
    if (data[key] === undefined) continue;
    recognized = true;
    if (data[key] === null) continue;
    const item = record(data[key], 'netease.vip.package');
    if (item.rights === false) continue;
    const expiresAt = integer(item.expireTime);
    if (expiresAt !== undefined) {
      if (expiresAt > now) benefits.push({ kind, expiresAt });
      continue;
    }
    // App 端有明确 rights 但不返回有效期时，只同步该标记，不制造到期日。
    if (item.rights === true && item.expireTime == null) { benefits.push({ kind }); continue; }
    throw new DomainError('invalid-response');
  }
  if (!recognized || (!benefits.length && (!Object.hasOwn(data, 'associator') || !Object.hasOwn(data, 'musicPackage')))) throw new DomainError('invalid-response');
  return { status: 'ready', benefits, syncedAt: now };
}
