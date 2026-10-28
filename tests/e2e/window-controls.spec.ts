/// <reference lib="dom" />
import { _electron, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import type { DesktopApi } from '../../packages/contracts/src/desktop';

test('真实窗口按钮、系统状态同步、双主题最小布局、粘顶和关闭退出', async () => {
  const profile = await mkdtemp('/tmp/starsmusic-window-e2e-');
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
  env.GSETTINGS_BACKEND = 'memory';
  const desktop = await _electron.launch({ args: ['.', `--user-data-dir=${profile}`], env, chromiumSandbox: true });
  try {
    const page = await desktop.firstWindow();
    const buttons = page.getByRole('group', { name: '窗口控制', exact: true });
    await expect(buttons).toBeVisible();
    const api = await page.evaluate(() => Object.keys((window as unknown as { starsMusic: DesktopApi }).starsMusic.window).sort());
    expect(api).toEqual(['close', 'getState', 'minimize', 'onChanged', 'toggleMaximize']);
    for (const theme of ['light', 'dark'] as const) {
      await page.getByRole('button', { name: '账号与设置', exact: true }).click();
      await page.getByRole('radio', { name: theme === 'light' ? '浅色' : '暗色', exact: true }).check();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.getByRole('navigation', { name: '音乐库', exact: true }).getByRole('button', { name: '音乐库', exact: true }).click();
      await page.setViewportSize({ width: 960, height: 640 });
      await expect(page.getByRole('button', { name: '关闭窗口', exact: true })).toBeVisible();
      const layout = await page.evaluate(() => {
        const controls = document.querySelector('.window-controls')!.getBoundingClientRect();
        const account = document.querySelector('.account-shortcut')!.getBoundingClientRect();
        const search = document.querySelector('.search-field')!.getBoundingClientRect();
        return { right: controls.right, width: innerWidth, separated: controls.left >= account.right && account.left >= search.right,
          drag: getComputedStyle(document.querySelector('.topbar')!).getPropertyValue('-webkit-app-region'),
          buttonDrag: getComputedStyle(document.querySelector('.window-controls button')!).getPropertyValue('-webkit-app-region') };
      });
      expect(layout.right).toBeLessThanOrEqual(layout.width); expect(layout.separated).toBe(true);
      expect(layout.drag).toBe('drag'); expect(layout.buttonDrag).toBe('no-drag');
      await page.locator('input[aria-label="搜索全部音乐来源"]').fill('合成输入验证');
      await expect(page.locator('input[aria-label="搜索全部音乐来源"]')).toHaveValue('合成输入验证');
      await page.getByRole('button', { name: '清空全部来源搜索', exact: true }).click();
      await page.screenshot({ path: `artifacts/window-controls-${theme}.png`, animations: 'disabled' });
    }
    await page.getByRole('button', { name: '最大化窗口', exact: true }).click();
    await expect.poll(() => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isMaximized())).toBe(true);
    await expect(page.getByRole('button', { name: '还原窗口', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '还原窗口', exact: true }).click();
    await expect.poll(() => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isMaximized())).toBe(false);
    // 外部窗口操作同样同步图标。
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.maximize());
    await expect(page.getByRole('button', { name: '还原窗口', exact: true })).toBeVisible();
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.unmaximize());
    await expect(page.getByRole('button', { name: '最大化窗口', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '最小化窗口', exact: true }).click();
    await expect.poll(() => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isMinimized())).toBe(true);
    await desktop.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]!; win.restore(); win.show(); win.focus(); });
    await page.getByRole('button', { name: '账号与设置', exact: true }).click();
    await page.locator('main').evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(page.getByRole('button', { name: '关闭窗口', exact: true })).toBeInViewport();
    const closed = desktop.waitForEvent('close');
    await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
    await closed;
  } finally { await desktop.close(); await rm(profile, { recursive: true, force: true }); }
});
