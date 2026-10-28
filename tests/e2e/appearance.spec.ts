/// <reference lib="dom" />
import { _electron, expect, test } from '@playwright/test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AppearanceApi } from '../../packages/contracts/src/appearance';

test('浅色、暗色、实时跟随系统和真实应用重启恢复外观偏好', async () => {
  const profile = await mkdtemp(path.join(tmpdir(), 'starsmusic-theme-e2e-'));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL; env.GSETTINGS_BACKEND = 'memory';
  const launch = () => _electron.launch({ args: ['.', `--user-data-dir=${profile}`, '--password-store=basic'], env, chromiumSandbox: true });
  let desktop: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    desktop = await launch(); let page = await desktop.firstWindow();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.getByRole('radio', { name: '跟随系统', exact: true })).toBeChecked();
    await page.getByRole('radio', { name: '浅色', exact: true }).check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
    await page.screenshot({ path: 'artifacts/theme-light-settings.png', animations: 'disabled' });
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByRole('radio', { name: '暗色', exact: true }).check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.screenshot({ path: 'artifacts/theme-dark-settings.png', animations: 'disabled' });
    await page.getByRole('radio', { name: '跟随系统', exact: true }).check();
    await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'system');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('radio', { name: '浅色', exact: true }).check();
    await expect(page.getByRole('radio', { name: '浅色', exact: true })).toBeChecked();
    await expect(page.getByRole('radio', { name: '浅色', exact: true })).toBeEnabled();
    const api = await page.evaluate(async () => {
      const appearance = (window as unknown as { starsMusic: { appearance: AppearanceApi } }).starsMusic.appearance;
      return { keys: Object.keys(appearance).sort(), saved: await appearance.getPreference() };
    });
    expect(api).toEqual({ keys: ['getPreference', 'setPreference'], saved: 'light' });
    await desktop.close(); desktop = undefined;
    desktop = await launch(); page = await desktop.firstWindow();
    await expect(page.getByRole('heading', { name: '音乐库', exact: true })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.getByRole('radio', { name: '浅色', exact: true })).toBeChecked();
    // 仅破坏本测试的临时外观文件，确认保存失败时 UI 和单选框一起回退。
    const file = path.join(profile, 'appearance.json');
    await rm(file); await mkdir(file);
    await page.getByRole('radio', { name: '暗色', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('外观偏好未能保存');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.getByRole('radio', { name: '浅色', exact: true })).toBeChecked();
    await rm(file, { recursive: true });
    await page.getByRole('radio', { name: '暗色', exact: true }).check();
    await expect(page.getByRole('radio', { name: '暗色', exact: true })).toBeEnabled();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  } finally { await desktop?.close(); await rm(profile, { recursive: true, force: true }); }
});
