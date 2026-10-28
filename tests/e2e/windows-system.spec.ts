/// <reference lib="dom" />
import { _electron, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DesktopApi } from '../../packages/contracts/src/desktop';

test.skip(process.platform !== 'win32', 'Windows 托盘与全局快捷键验证');

test('真实 Windows Electron：托盘、关闭隐藏/恢复、实际快捷键注册与设置跨重启保存', async () => {
  const profile = await mkdtemp(path.join(tmpdir(), 'starsmusic-windows-e2e-'));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
  const launch = () => _electron.launch({ args: ['.', `--user-data-dir=${profile}`], env, chromiumSandbox: true, timeout: 10_000 });
  let desktop: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    desktop = await launch(); let page = await desktop.firstWindow();
    await expect(page.getByRole('heading', { name: '音乐库', exact: true })).toBeVisible();
    const state = () => page.evaluate(() => (window as unknown as { starsMusic: DesktopApi }).starsMusic.system.getState());
    const set = (key: 'tray' | 'closeToTray' | 'globalShortcuts', enabled: boolean) => page.evaluate(({ key, enabled }) =>
      (window as unknown as { starsMusic: DesktopApi }).starsMusic.system.setPreference(key, enabled), { key, enabled });
    await expect.poll(async () => (await state()).tray.state).toBe('available');
    expect((await state()).preferences.closeToTray).toBe(false);
    expect((await state()).mpris.state).toBe('unavailable'); expect((await state()).notifications.state).toBe('unavailable');
    await page.getByRole('button', { name: '账号与设置', exact: true }).click();
    await expect(page.getByRole('heading', { name: '桌面集成', exact: true })).toBeVisible();
    await expect(page.getByText('MPRIS 媒体控制', { exact: true })).toHaveCount(0);
    await expect(page.getByText('桌面 Portal', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: 'artifacts/windows-desktop-settings.png', animations: 'disabled' });
    const registered = await set('globalShortcuts', true);
    const actual = await desktop.evaluate(({ globalShortcut }, accelerators) => accelerators.map(key => globalShortcut.isRegistered(key)), registered.bindings.map(binding => binding.accelerator));
    expect(registered.bindings.map(binding => binding.state === 'available')).toEqual(actual);
    expect(registered.bindings).toHaveLength(5);
    await set('globalShortcuts', false);
    expect(await desktop.evaluate(({ globalShortcut }, accelerators) => accelerators.some(key => globalShortcut.isRegistered(key)), registered.bindings.map(binding => binding.accelerator))).toBe(false);
    await set('closeToTray', true);
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
    expect(await desktop.evaluate(({ BrowserWindow }) => ({ count: BrowserWindow.getAllWindows().length, visible: BrowserWindow.getAllWindows()[0]!.isVisible() }))).toEqual({ count: 1, visible: false });
    // 禁用托盘会恢复隐藏窗口，不依赖测试点击通知区域的具体位置。
    await set('tray', false);
    expect(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible())).toBe(true);
    expect((await state()).preferences.closeToTray).toBe(false);
    await set('tray', true); await set('closeToTray', true);
    await desktop.close(); desktop = undefined;
    desktop = await launch(); page = await desktop.firstWindow();
    await expect(page.getByRole('heading', { name: '音乐库', exact: true })).toBeVisible();
    await expect.poll(async () => (await state()).tray.state).toBe('available');
    expect((await state()).preferences).toMatchObject({ tray: true, closeToTray: true, globalShortcuts: false });
    const closed = desktop.waitForEvent('close');
    await page.evaluate(() => (window as unknown as { starsMusic: DesktopApi }).starsMusic.system.quit());
    await closed;
  } finally { await desktop?.close(); await rm(profile, { recursive: true, force: true }); }
});
