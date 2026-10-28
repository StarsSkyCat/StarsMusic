import assert from 'node:assert/strict';
import test from 'node:test';
import { initialNeteaseSnapshot } from '../../packages/contracts/src/netease.ts';
import { initialKugouSnapshot } from '../../packages/contracts/src/kugou.ts';
import { membershipLabel } from '../../src/renderer/src/membership-label.ts';

test('紧凑会员标记区分 VIP/SVIP，过滤过期和未开始套餐，不把专辑权益当会员', () => {
  const netease = { ...initialNeteaseSnapshot(), status: 'connected' as const, membership: { status: 'ready' as const, benefits: [{ kind: 'vip' as const }, { kind: 'svip' as const, expiresAt: 2000 }] } };
  assert.equal(membershipLabel('netease', netease, 1000).label, 'SVIP');
  assert.equal(membershipLabel('netease', netease, 2000).label, 'VIP');
  assert.equal(membershipLabel('netease', { ...netease, status: 'signed-out' }, 1000).label, '');
  assert.equal(membershipLabel('netease', { ...netease, membership: { status: 'ready', benefits: [{ kind: 'album' }] } }, 1000).label, '');
  const kugou = { ...initialKugouSnapshot(), status: 'connected' as const, membership: { status: 'error' as const, benefits: [{ kind: 'standard' as const }, { kind: 'svip' as const, expiresAt: 999 }, { kind: 'qvip' as const, startsAt: 2000 }] } };
  assert.deepEqual(membershipLabel('kugou', kugou, 1000), { label: 'VIP', detail: '标准版 VIP' });
  assert.equal(membershipLabel('kugou', { ...kugou, membership: { status: 'error', benefits: [] } }, 1000).label, '');
});
