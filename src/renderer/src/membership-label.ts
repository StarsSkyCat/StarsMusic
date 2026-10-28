import type { NeteaseSnapshot } from '../../../packages/contracts/src/netease';
import type { KugouSnapshot } from '../../../packages/contracts/src/kugou';

export function membershipLabel(provider: 'netease' | 'kugou', state: NeteaseSnapshot | KugouSnapshot, now = Date.now()): { label: string; detail: string } {
  if (state.status !== 'connected') return { label: '', detail: '' };
  const active = state.membership.benefits.filter(item => (item.expiresAt === undefined || item.expiresAt > now)
    && (!('startsAt' in item) || item.startsAt === undefined || item.startsAt <= now));
  const netease = provider === 'netease';
  const names = { vip: '黑胶 VIP', svip: netease ? 'SVIP' : '概念版 VIP', 'music-package': '音乐包', album: '数字专辑',
    standard: '标准版 VIP', super: '超级 VIP', tvip: '畅听 VIP', qvip: 'QVIP', dvip: 'DVIP', other: '其他会员' };
  const label = active.some(item => item.kind === 'super' || netease && item.kind === 'svip') ? 'SVIP'
    : active.some(item => item.kind !== 'album' && item.kind !== 'music-package') ? 'VIP'
    : active.some(item => item.kind === 'music-package') ? '音乐包' : '';
  return { label, detail: active.map(item => names[item.kind]).join(' · ') };
}
