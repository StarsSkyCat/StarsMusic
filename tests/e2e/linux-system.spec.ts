/// <reference lib="dom" />
import { _electron, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import dbus from 'dbus-next';
import { isolatedSessionBus } from '../helpers/isolated-bus';
import { SyntheticDesktopServices } from '../helpers/desktop-services';
import { createBus, sessionAddress, call } from '../../packages/desktop/src/linux/bus';
import type { SystemApi } from '../../packages/contracts/src/system';
import type { PlaybackApi } from '../../packages/contracts/src/playback';

test.skip(process.platform !== 'linux', 'Linux D-Bus/portal 专属验证');

test('实际 Electron / 独立总线合成宿主：托盘注册、portal 确认、窗口快捷键、关闭恢复、服务丢失和持久设置', async () => {
  test.setTimeout(45000);
  const profile = await mkdtemp('/tmp/starsmusic-system-e2e-'); const isolated = await isolatedSessionBus(profile);
  const server = new SyntheticDesktopServices(createBus(sessionAddress({ DBUS_SESSION_BUS_ADDRESS: isolated.address }, process.getuid?.())), true); await server.initialize();
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
  env.DBUS_SESSION_BUS_ADDRESS = isolated.address; env.XDG_SESSION_TYPE = 'wayland'; env.XDG_CURRENT_DESKTOP = 'synthetic-portal-test'; env.GSETTINGS_BACKEND = 'memory';
  const launch = () => _electron.launch({ args: ['.', `--user-data-dir=${profile}`, '--password-store=basic'], env, chromiumSandbox: true });
  let desktop: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    desktop = await launch(); let page = await desktop.firstWindow(); await page.setViewportSize({ width: 1280, height: 900 });
    const state = () => page.evaluate(async () => (window as unknown as { starsMusic: { system: SystemApi } }).starsMusic.system.getState());
    const playback = () => page.evaluate(async () => (window as unknown as { starsMusic: { playback: PlaybackApi } }).starsMusic.playback.getState());
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.getByRole('heading', { name: '桌面设置', exact: true })).toBeVisible();
    await expect.poll(async () => (await state()).mpris.state).toBe('available');
    await expect.poll(async () => server.watcher.items.length).toBeGreaterThan(0);
    await expect.poll(async () => (await state()).tray.state).toBe('available');
    await expect(page.getByRole('checkbox', { name: /关闭窗口后留在托盘/ })).toBeEnabled();
    await page.getByRole('checkbox', { name: /申请全局快捷键/ }).check();
    await expect.poll(async () => (await state()).shortcuts.state).toBe('available');
    expect((await state()).bindings.every(binding => binding.trigger?.startsWith('Synthetic accepted'))).toBe(true);
    server.activate('mute'); await expect.poll(async () => (await playback()).muted).toBe(true);
    await page.getByText('快捷键与媒体键', { exact: true }).click();
    await desktop.evaluate(({ BrowserWindow }) => { const contents = BrowserWindow.getAllWindows()[0]!.webContents; contents.focus(); for (const keyCode of ['O', 'M']) { contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: ['control', 'alt'] }); contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers: ['control', 'alt'] }); } }); await expect.poll(async () => (await playback()).muted).toBe(false);
    await page.getByRole('checkbox', { name: /关闭窗口后留在托盘/ }).check();
    await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
    await expect.poll(async () => desktop!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible())).toBe(false);
    // 真实 Electron StatusNotifierItem 的 D-BusMenu，合成宿主不在真实桌面显示图标。
    const item = server.watcher.items.at(-1)!; const slash = item.indexOf('/'); const itemName = slash < 0 ? item : item.slice(0, slash); const itemPath = slash < 0 ? '/StatusNotifierItem' : item.slice(slash);
    const menuProperty = await call(server.bus, itemName, itemPath, 'org.freedesktop.DBus.Properties', 'Get', 'ss', ['org.kde.StatusNotifierItem', 'Menu']);
    const menuPath = (menuProperty[0] as dbus.Variant<string>).value;
    const layout = await call(server.bus, itemName, menuPath, 'com.canonical.dbusmenu', 'GetLayout', 'iias', [0, -1, []]);
    const find = (node: unknown): number | undefined => {
      if (typeof node !== 'object' || node === null) return undefined;
      const raw = node instanceof dbus.Variant ? node.value as unknown : node;
      if (!Array.isArray(raw)) return undefined;
      const props = raw[1] as Record<string, dbus.Variant> | undefined;
      if (props?.label?.value === '显示 StarsMusic') return raw[0] as number;
      for (const child of (raw[2] as unknown[] | undefined) ?? []) { const match = find(child); if (match !== undefined) return match; }
      return undefined;
    };
    const showItem = find(layout[1]); expect(showItem).toBeDefined();
    await call(server.bus, itemName, menuPath, 'com.canonical.dbusmenu', 'Event', 'isvu', [showItem!, 'clicked', new dbus.Variant('s', ''), 0]);
    await expect.poll(async () => desktop!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible())).toBe(true);
    await expect(page.getByRole('button', { name: '发送测试通知', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '重新检测桌面能力', exact: true })).toHaveCount(0);
    // 诊断从用户设置移除，底层通知仍在隔离总线验证。
    await page.evaluate(() => (window as unknown as { starsMusic: { system: SystemApi } }).starsMusic.system.testNotification());
    await expect.poll(() => server.notifications.received.length).toBe(1);
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.hide());
    server.notifications.ActionInvoked(server.notifications.received[0]!.id, 'default');
    await expect.poll(async () => desktop!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible())).toBe(true);
    await page.screenshot({ path: 'artifacts/linux-desktop-integration.png', animations: 'disabled' });
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.hide()); server.watcher.setHost(false);
    await expect.poll(async () => (await state()).tray.state).toBe('unavailable');
    await expect.poll(async () => desktop!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible())).toBe(true);
    server.watcher.setHost(true); await expect.poll(async () => (await state()).tray.state).toBe('available');
    await page.getByRole('checkbox', { name: /申请全局快捷键/ }).uncheck();
    await page.getByRole('checkbox', { name: /启用系统托盘/ }).uncheck();
    expect((await state()).preferences.closeToTray).toBe(false);
    await desktop.close(); desktop = undefined;
    desktop = await launch(); page = await desktop.firstWindow(); await page.getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: /启用系统托盘/ })).not.toBeChecked();
    await expect(page.getByRole('checkbox', { name: /申请全局快捷键/ })).not.toBeChecked();
    const projection = await state(); expect(projection.tray.state).toBe('disabled'); expect(projection.shortcuts.state).toBe('disabled');
    expect(JSON.stringify(projection)).not.toContain(isolated.address);
    const keys = await page.evaluate(() => Object.keys((window as unknown as { starsMusic: { system: SystemApi } }).starsMusic.system).sort());
    expect(keys).toEqual(['getState', 'onChanged', 'quit', 'refresh', 'setPreference', 'testNotification']);
  } finally { await desktop?.close(); await server.dispose(); await isolated.close(); await rm(profile, { recursive: true, force: true }); }
});
