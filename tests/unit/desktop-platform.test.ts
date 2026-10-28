import test from 'node:test';
import assert from 'node:assert/strict';
import { desktopEnvironment } from '../../packages/desktop/src/platform.ts';
import { sessionAddress } from '../../packages/desktop/src/linux/bus.ts';

test('桌面环境只报告声明值，Wayland display 或桌面名称本身不等于能力可用', () => {
  assert.deepEqual(desktopEnvironment({ XDG_SESSION_TYPE: 'wayland', XDG_CURRENT_DESKTOP: 'niri' }), { session: 'wayland', desktop: 'niri' });
  assert.equal(desktopEnvironment({ WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' }).session, 'unknown');
  assert.equal(desktopEnvironment({ XDG_SESSION_TYPE: 'x11', XDG_CURRENT_DESKTOP: 'KDE' }).session, 'x11');
  assert.equal(desktopEnvironment({ XDG_CURRENT_DESKTOP: '<unsafe>' }).desktop, 'unsafe');
});
test('D-Bus 仅接受本地 Unix 地址，禁用命令执行、TCP 和畸形路径，无 native addon', () => {
  assert.equal(sessionAddress({ DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus,guid=test' }, 1000), 'unix:socket=/run/user/1000/bus');
  assert.equal(sessionAddress({}, 1000), 'unix:socket=/run/user/1000/bus');
  assert.equal(sessionAddress({ DBUS_SESSION_BUS_ADDRESS: 'unix:abstract=synthetic' }, 1000), 'unix:socket=\0synthetic');
  for (const address of ['unixexec:path=/bin/sh', 'tcp:host=example.invalid,port=123', 'unix:path=relative', 'unix:path=/tmp/%00bad', 'unix:path=/tmp/%3bexec']) assert.throws(() => sessionAddress({ DBUS_SESSION_BUS_ADDRESS: address }, 1000));
});

import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { DesktopSettings } from '../../packages/desktop/src/settings.ts';
import { defaultSystemPreferences, parseSystemPreferences, parseSystemArguments, systemChannels, parseSystemSnapshot } from '../../packages/contracts/src/system.ts';
import { DesktopController } from '../../packages/desktop/src/controller.ts';
import { capability, type DesktopServices, type PresentationPort } from '../../packages/desktop/src/platform.ts';
import type { DesktopRuntime } from '../../packages/desktop/src/runtime.ts';
import { MusicPlayer } from '../../packages/playback/src/player.ts';
import { windowShortcut } from '../../packages/desktop/src/shortcuts.ts';

test('系统 IPC 只允许具体无参操作和四个布尔设置，禁止任意路径/命令/快捷键', () => {
  assert.deepEqual(parseSystemArguments(systemChannels.setPreference, ['notifications', true]), { key: 'notifications', enabled: true });
  assert.equal(parseSystemArguments(systemChannels.refresh, []), undefined);
  for (const [command, args] of [[systemChannels.setPreference, ['execute', 'shell']], [systemChannels.setPreference, ['tray', 'true']], [systemChannels.getState, ['path']], ['arbitrary-command', []], [systemChannels.testNotification, ['任意消息']]] as const) assert.throws(() => parseSystemArguments(command, args));
  assert.throws(() => parseSystemPreferences({ ...defaultSystemPreferences(), token: 'synthetic' }));
});

test('桌面设置只保存白名单布尔值，跨实例恢复；未知版本原样保留，不默默覆盖', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'starsmusic-desktop-settings-')); const file = path.join(directory, 'desktop.json');
  try {
    const store = new DesktopSettings(file); assert.equal(await store.initialize(), true);
    const next = { ...defaultSystemPreferences(), notifications: true, globalShortcuts: true };
    await store.write(next); const reopened = new DesktopSettings(file); assert.equal(await reopened.initialize(), true); assert.deepEqual(reopened.snapshot(), next);
    assert.throws(() => store.write({ ...next, path: '/tmp/forbidden' } as typeof next));
    await store.close(); await reopened.close();
    const invalid = JSON.stringify({ version: 99, preferences: next }); await writeFile(file, invalid);
    const newer = new DesktopSettings(file); assert.equal(await newer.initialize(), false); assert.deepEqual(newer.snapshot(), defaultSystemPreferences());
    await assert.rejects(newer.write(next)); assert.equal(await readFile(file, 'utf8'), invalid); await newer.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('X11 按每项实际注册结果报告；保存失败不改变快捷键状态，禁用和退出准确注销，不宣称其他平台可用', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'starsmusic-desktop-controller-')); const file = path.join(directory, 'desktop.json');
  const player = new MusicPlayer(); const callbacks = new Map<string, () => void>(); const removed: string[] = [];
  const runtime: DesktopRuntime = { show() {}, quit() {}, hide() {}, isVisible: () => true, createTray() { throw new Error('no host'); },
    registerShortcut(accelerator, callback) { if (accelerator.endsWith('Space')) return false; callbacks.set(accelerator, callback); return true; }, unregisterShortcut(accelerator) { removed.push(accelerator); callbacks.delete(accelerator); } };
  const presentation: PresentationPort = { snapshot: () => ({ revision: 0, generation: 0, trackId: null, status: 'idle' }), subscribe: () => () => undefined };
  const unavailable = capability('unavailable', '合成缺失服务');
  const state: DesktopServices = { session: 'x11', desktop: '合成 X11', bus: unavailable, mpris: unavailable, notifications: unavailable, trayHost: unavailable, portal: unavailable, globalShortcuts: unavailable };
  const services = { initialize: async () => undefined, snapshot: () => state, subscribe: () => () => undefined, connection: () => undefined, refresh: async () => state, setArt() {}, dispose: async () => undefined };
  const controller = new DesktopController(player, presentation, runtime, new DesktopSettings(file), 'linux', services);
  try {
    await controller.initialize(); await controller.setPreference('globalShortcuts', true);
    assert.equal(controller.snapshot().shortcuts.state, 'unknown'); assert.equal(callbacks.size, 4);
    assert.equal(controller.snapshot().bindings.find(binding => binding.id === 'toggle')?.state, 'unavailable');
    callbacks.get('Control+Alt+M')!(); assert.equal(player.snapshot().muted, true);
    const publicState = parseSystemSnapshot({ ...controller.snapshot(), secret: 'synthetic-private-marker' }); assert.equal(JSON.stringify(publicState).includes('synthetic-private-marker'), false);
    await rm(file); await mkdir(file); await controller.setPreference('globalShortcuts', false);
    assert.equal(controller.snapshot().error?.code, 'desktop-save-failed'); assert.equal(controller.snapshot().preferences.globalShortcuts, true); assert.equal(callbacks.size, 4);
    await rm(file, { recursive: true }); await controller.setPreference('globalShortcuts', false); assert.equal(controller.snapshot().error, undefined); assert.equal(callbacks.size, 0); assert.equal(removed.length, 4);
    const other = new DesktopController(player, presentation, runtime, new DesktopSettings(path.join(directory, 'unsupported.json')), 'win32');
    await other.initialize(); await other.setPreference('globalShortcuts', true); assert.equal(other.snapshot().mpris.state, 'unavailable'); assert.equal(other.snapshot().shortcuts.state, 'unavailable'); assert.equal(callbacks.size, 0); await other.dispose();
  } finally { await controller.dispose(); await player.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test('窗口快捷键精确匹配组合，不抢普通输入/媒体键/自动重复', () => {
  const input = { type: 'keyDown', key: ' ', control: true, alt: true, shift: false, meta: false, isAutoRepeat: false };
  assert.equal(windowShortcut(input), 'toggle'); assert.equal(windowShortcut({ ...input, key: 'ArrowRight' }), 'next');
  for (const changed of [{ control: false }, { alt: false }, { shift: true }, { meta: true }, { isAutoRepeat: true }, { type: 'keyUp' }, { key: 'MediaPlayPause' }]) assert.equal(windowShortcut({ ...input, ...changed }), undefined);
});
