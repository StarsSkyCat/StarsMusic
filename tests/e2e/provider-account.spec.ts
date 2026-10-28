/// <reference lib="dom" />
import { _electron, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initialNeteaseSnapshot, neteaseChannels } from '../../packages/contracts/src/netease';
import { initialKugouSnapshot, kugouChannels } from '../../packages/contracts/src/kugou';

test('双平台紧凑账号入口：小会员标记、菜单开关、退出与扫码，双主题最小窗口', async () => {
  const profile = await mkdtemp(path.join(tmpdir(), 'starsmusic-compact-account-'));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL; env.GSETTINGS_BACKEND = 'memory';
  const desktop = await _electron.launch({ args: ['.', `--user-data-dir=${profile}`], env, chromiumSandbox: true });
  try {
    const page = await desktop.firstWindow();
    await expect(page.getByRole('heading', { name: '音乐库', exact: true })).toBeVisible();
    // Explicit UI fixtures and command capture only; no real QR, account, or platform login.
    await desktop.evaluate(({ ipcMain, BrowserWindow }, { sources }) => {
      for (const { provider, channels, initial } of sources) {
        let state: typeof initial = { ...initial, revision: 100, generation: 50, status: 'connected', account: { id: '42', nickname: `合成${provider}账号` }, membership: { status: 'ready', benefits: [{ kind: provider === 'netease' ? 'svip' : 'standard' }] } } as typeof initial;
        const publish = () => { state = { ...state, revision: state.revision + 1 }; BrowserWindow.getAllWindows()[0]!.webContents.send(channels.stateChanged, state); return state; };
        for (const channel of [channels.browse, channels.loadPlaylists, channels.refreshMembership, channels.logout, channels.startLogin, channels.cancelLogin]) ipcMain.removeHandler(channel);
        ipcMain.handle(channels.browse, publish); ipcMain.handle(channels.loadPlaylists, publish); ipcMain.handle(channels.refreshMembership, publish);
        ipcMain.handle(channels.logout, () => { state = { ...initial, revision: state.revision, generation: state.generation + 1 } as typeof state; return publish(); });
        ipcMain.handle(channels.startLogin, () => { state = { ...state, status: 'waiting-scan', expiresAt: Date.now() + 120000, qrImage: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' } as typeof state; return publish(); });
        ipcMain.handle(channels.cancelLogin, () => { state = { ...initial, revision: state.revision, generation: state.generation, status: 'cancelled' }; return publish(); });
        publish();
      }
    }, { sources: [{ provider: 'netease', channels: neteaseChannels, initial: initialNeteaseSnapshot() }, { provider: 'kugou', channels: kugouChannels, initial: initialKugouSnapshot() }] });
    for (const [provider, name, badge] of [['netease', '网易云音乐', 'SVIP'], ['kugou', '酷狗音乐', 'VIP']] as const) {
      await page.getByRole('navigation', { name: '音乐来源', exact: true }).getByRole('button', { name: new RegExp(`^${name}`) }).click();
      const trigger = page.locator('.provider-account-trigger');
      const panel = page.getByRole('dialog', { name: `${name}账号`, exact: true });
      await expect(page.locator('.account-card')).toHaveCount(0);
      await expect(page.locator('.ne-masthead .account-vip')).toHaveText(badge);
      await expect(panel).toHaveCount(0);
      for (const theme of ['浅色', '暗色']) {
        await page.getByRole('button', { name: '设置', exact: true }).click();
        await page.getByRole('radio', { name: theme, exact: true }).check();
        await page.getByRole('navigation', { name: '音乐来源', exact: true }).getByRole('button', { name: new RegExp(`^${name}`) }).click();
        await page.setViewportSize({ width: 960, height: 640 });
        await page.screenshot({ path: `artifacts/compact-${provider}-${theme === '浅色' ? 'light' : 'dark'}-closed.png`, animations: 'disabled' });
        await trigger.click(); await expect(panel).toContainText('已连接');
        const layout = await panel.evaluate(element => {
          const rect = element.getBoundingClientRect(); const main = document.querySelector('main')!.getBoundingClientRect();
          return { right: rect.right <= main.right, bottom: rect.bottom <= main.bottom, width: rect.width };
        });
        expect(layout.right).toBe(true); expect(layout.bottom).toBe(true); expect(layout.width).toBeLessThan(360);
        await page.screenshot({ path: `artifacts/compact-${provider}-${theme === '浅色' ? 'light' : 'dark'}.png`, animations: 'disabled' });
        await page.keyboard.press('Escape'); await expect(panel).toHaveCount(0); await expect(trigger).toBeFocused();
        await trigger.click(); await page.getByRole('heading', { level: 1, name, exact: true }).click(); await expect(panel).toHaveCount(0);
      }
      await trigger.click(); await panel.getByRole('button', { name: provider === 'netease' ? '退出网易云' : '退出酷狗', exact: true }).click();
      await expect(panel).toHaveCount(0); await expect(trigger.locator('.account-vip')).toHaveCount(0);
      await trigger.click(); await panel.getByRole('button', { name: provider === 'netease' ? '连接网易云' : '连接酷狗', exact: true }).click();
      await expect(panel.getByRole('img')).toBeVisible();
      const remember = panel.getByRole('checkbox', { name: `记住${name}登录`, exact: true });
      await remember.check(); await expect(remember).toBeChecked();
      await panel.getByRole('button', { name: '取消授权', exact: true }).click();
      await expect(panel.getByRole('img')).toHaveCount(0);
    }
  } finally { await desktop.close(); await rm(profile, { recursive: true, force: true }); }
});
