/// <reference lib="dom" />
import { _electron, expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('桌面窗口、实际 IPC、沙箱隔离、弹窗与导航阻断及退出', async () => {
  const profile = await mkdtemp(path.join(tmpdir(), 'starsmusic-e2e-'));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  env.GSETTINGS_BACKEND = 'memory';
  const args = ['.', `--user-data-dir=${profile}`];
  const desktop = await _electron.launch({ args, env, chromiumSandbox: true, timeout: 10_000 })
    .catch(async (error: unknown) => {
      await rm(profile, { recursive: true, force: true });
      throw error;
    });
  try {
    const page = await desktop.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await test.step('页面与真实 IPC', async () => {
      await expect(page.getByRole('heading', { name: '音乐库还是空的' })).toBeVisible();
      await expect(page.getByRole('status')).toContainText('桌面桥接已连接');
      await page.getByRole('button', { name: '重新检查' }).click();
      await expect(page.getByRole('status')).toContainText('StarsMusic 0.0.0');

      const exposure = await page.evaluate(async () => {
        const api = (window as unknown as { starsMusic: { getAppInfo(): Promise<unknown> } }).starsMusic;
        return {
          keys: Object.keys(api),
          info: await api.getAppInfo(),
          require: typeof Reflect.get(window, 'require'),
          process: typeof Reflect.get(window, 'process'),
          ipcRenderer: typeof Reflect.get(window, 'ipcRenderer'),
        };
      });
      expect(exposure.keys).toEqual(['getAppInfo']);
      expect(exposure.info).toMatchObject({ name: 'StarsMusic', version: '0.0.0' });
      expect([exposure.require, exposure.process, exposure.ipcRenderer]).toEqual(['undefined', 'undefined', 'undefined']);
    });

    await test.step('内存会话与 renderer 沙箱', async () => {
      const isolation = await desktop.evaluate(({ app, BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]!;
        return {
          sandboxed: app.getAppMetrics().find((metric) => metric.pid === window.webContents.getOSProcessId())?.sandboxed,
          rendererPid: window.webContents.getOSProcessId(),
          persistentSession: window.webContents.session.isPersistent(),
        };
      });
      expect(isolation.persistentSession).toBe(false);
      if (process.platform === 'linux') {
        const status = await readFile(`/proc/${isolation.rendererPid}/status`, 'utf8');
        expect(status).toMatch(/^Seccomp:\s+2$/m);
        expect(status).toMatch(/^NoNewPrivs:\s+1$/m);
      } else {
        expect(isolation.sandboxed).toBe(true);
      }
    });

    await test.step('拒绝新窗口', async () => {
      await page.evaluate(() => { window.open('https://example.invalid/'); });
      expect(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    });

    await test.step('最小窗口布局', async () => {
      // Wayland 合成器可忽略原生 setSize，显式设置视口以验证准确的布局尺寸。
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.screenshot({ path: 'artifacts/desktop-default.png' });
      await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(960, 640));
      await page.setViewportSize({ width: 960, height: 640 });
      await page.getByRole('button', { name: '重新检查' }).scrollIntoViewIfNeeded();
      await expect(page.getByRole('button', { name: '重新检查' })).toBeInViewport();
      await page.screenshot({ path: 'artifacts/desktop-minimum.png' });
      expect(errors).toEqual([]);
    });

    await test.step('拒绝主文档导航', async () => {
      const originalUrl = page.url();
      await page.evaluate(() => { window.location.href = 'https://example.invalid/'; });
      expect(await page.evaluate(() => window.location.href)).toBe(originalUrl);
      // Chromium 已取消导航；直接检查原文档，避免 Playwright 等待一个已被取消的导航。
      expect(await page.evaluate(() => document.querySelector('h1')?.textContent)).toContain('开启音乐之旅');
    });

    await test.step('关闭窗口退出', async () => {
      if (process.platform !== 'darwin') {
        const closed = desktop.waitForEvent('close');
        await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
        await closed;
      }
    });
  } finally {
    await desktop.close();
    await rm(profile, { recursive: true, force: true });
  }
});
