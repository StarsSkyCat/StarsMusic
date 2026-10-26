import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { appearanceChannels, parseAppearanceArguments, parseThemePreference } from '../../packages/contracts/src/appearance.ts';
import { AppearanceStore } from '../../src/main/appearance-store.ts';

test('外观 IPC 只接受三种枚举和精确参数数量', () => {
  for (const preference of ['system', 'light', 'dark']) assert.equal(parseThemePreference(preference), preference);
  assert.equal(parseAppearanceArguments(appearanceChannels.getPreference, []), undefined);
  assert.equal(parseAppearanceArguments(appearanceChannels.setPreference, ['light']), 'light');
  for (const value of [undefined, null, {}, 1, 'LIGHT', '/tmp/file', { theme: 'dark' }]) assert.throws(() => parseThemePreference(value));
  for (const [channel, args] of [
    [appearanceChannels.getPreference, ['dark']], [appearanceChannels.setPreference, []],
    [appearanceChannels.setPreference, ['light', 'extra']], ['arbitrary-channel', []],
  ] as const) assert.throws(() => parseAppearanceArguments(channel, args));
});

test('外观偏好跨实例保存，快速设置按顺序落盘且只写入公开枚举', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'starsmusic-appearance-'));
  try {
    const file = path.join(directory, 'settings', 'appearance.json');
    const store = new AppearanceStore(file); await store.initialize();
    assert.equal(store.getPreference(), 'system');
    await Promise.all([store.setPreference('light'), store.setPreference('dark'), store.setPreference('system')]);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { version: 1, theme: 'system' });
    await store.setPreference('light');
    const restored = new AppearanceStore(file); await restored.initialize();
    assert.equal(restored.getPreference(), 'light');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('损坏、未知版本和无效外观文件回退系统模式，原文件保留', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'starsmusic-appearance-'));
  try {
    const file = path.join(directory, 'appearance.json');
    for (const content of ['bad json', '{"version":2,"theme":"dark"}', '{"version":1,"theme":"invalid"}', 'null']) {
      await writeFile(file, content);
      const store = new AppearanceStore(file); await store.initialize();
      assert.equal(store.getPreference(), 'system'); assert.equal(await readFile(file, 'utf8'), content);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('外观存储失败不冒充保存，修复目录后可重试', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'starsmusic-appearance-'));
  try {
    const blocker = path.join(directory, 'settings'); await writeFile(blocker, 'not a directory');
    const store = new AppearanceStore(path.join(blocker, 'appearance.json'));
    await assert.rejects(store.setPreference('light')); assert.equal(store.getPreference(), 'system');
    await rm(blocker); await store.setPreference('dark'); assert.equal(store.getPreference(), 'dark');
    assert.throws(() => store.setPreference({ theme: 'light' }));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
