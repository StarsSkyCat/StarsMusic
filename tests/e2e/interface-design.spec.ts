/// <reference lib="dom" />
import { _electron, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DesktopApi } from '../../packages/contracts/src/desktop';
import { playbackChannels } from '../../packages/contracts/src/playback';

test('界面重设计：双主题导航、最小窗口、继续聆听、队列键盘闭环与减少透明度', async () => {
  const profile = await mkdtemp(path.join(tmpdir(), 'starsmusic-interface-e2e-'));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL; env.GSETTINGS_BACKEND = 'memory';
  const app = await _electron.launch({ args: ['.', `--user-data-dir=${profile}`, '--password-store=basic'], env, chromiumSandbox: true });
  try {
    const page = await app.firstWindow(); page.setDefaultTimeout(5000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await expect(page.getByRole('heading', { name: '音乐库', exact: true })).toBeVisible();
    // 只投影明确标记的合成长歌名，不请求平台、登录或伪造播放成功。
    const snapshot = await page.evaluate(() => (window as unknown as { starsMusic: DesktopApi }).starsMusic.playback.getState());
    await app.evaluate(({ BrowserWindow }, { channel, snapshot }) => {
      BrowserWindow.getAllWindows()[0]!.webContents.send(channel, { ...snapshot, revision: snapshot.revision + 100, generation: snapshot.generation + 1, status: 'paused', currentIndex: 0,
        queue: [{ id: 'synthetic-design', title: '合成界面验证 · 一首名称很长的歌曲用于检查窄窗口中的截断与按钮布局', artist: '合成歌手', provider: 'local' }], positionSeconds: 0, durationSeconds: 30 });
    }, { channel: playbackChannels.stateChanged, snapshot });
    for (const theme of ['light', 'dark']) {
      await page.getByRole('button', { name: '设置', exact: true }).click();
      await expect(page.locator('.settings-content .account-card, .credential-panel, .desktop-capabilities')).toHaveCount(0);
      await expect(page.getByRole('button', { name: '清除已保存登录', exact: true })).toHaveCount(0);
      const radio = page.getByRole('radio', { name: theme === 'light' ? '浅色' : '暗色', exact: true });
      await radio.check(); await expect(radio).toBeEnabled();
      for (const size of [{ width: 960, height: 640 }, { width: 1440, height: 900 }]) {
        await page.setViewportSize(size);
        for (const [name, surface] of [['音乐库', 'library'], ['本地音乐', 'local'], ['正在播放', 'playing'], ['设置', 'settings']] as const) {
          const navigation = page.locator('.sidebar').getByRole('button', { name: new RegExp(`^${name}`) });
          await navigation.click();
          await expect(navigation).toHaveAttribute('aria-current', 'page');
          await expect(page.getByRole('button', { name: '最小化窗口', exact: true })).toBeInViewport();
          const geometry = await page.evaluate(() => {
            const main = document.querySelector('main')!;
            const footer = document.querySelector('footer')!;
            return { mainOverflow: main.scrollWidth - main.clientWidth, footerOverflow: footer.scrollWidth - footer.clientWidth,
              overlap: main.getBoundingClientRect().bottom > footer.getBoundingClientRect().top };
          });
          expect(geometry).toEqual({ mainOverflow: 0, footerOverflow: 0, overlap: false });
          if (surface === 'library') {
            const hero = page.locator('.library-overview');
            await expect(hero.locator('.library-current')).toBeVisible();
            const overlap = await hero.evaluate(node => {
              const actions = Array.from(node.querySelectorAll('.library-actions button')).map(button => button.getBoundingClientRect());
              const current = node.querySelector('.library-current')!.getBoundingClientRect();
              return actions.some(button => button.right > current.left && button.bottom > current.top && current.bottom > button.top);
            });
            expect(overlap).toBe(false);
          }
          await page.screenshot({ path: `artifacts/redesign/${theme}-${surface}-${size.width}.png`, animations: 'disabled' });
        }
      }
      const queue = page.getByRole('button', { name: '打开播放队列', exact: true });
      await queue.press('Enter');
      const dialog = page.getByRole('dialog', { name: /播放队列/ });
      await expect(dialog).toBeVisible();
      await page.screenshot({ path: `artifacts/redesign/${theme}-queue.png`, animations: 'disabled' });
      await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible(); await expect(queue).toBeFocused();
    }
    // Chromium CDP 仅用于媒体偏好模拟，验证透明材质在减少透明度时退化为实底。
    const session = await page.context().newCDPSession(page);
    await session.send('Emulation.setEmulatedMedia', { features: [
      { name: 'prefers-reduced-transparency', value: 'reduce' }, { name: 'prefers-reduced-motion', value: 'reduce' },
    ] });
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-transparency: reduce)').matches)).toBe(true);
    await expect(page.locator('.sidebar')).toHaveCSS('backdrop-filter', 'none');
    await expect(page.locator('.player')).toHaveCSS('backdrop-filter', 'none');
    await page.getByRole('button', { name: '打开播放队列', exact: true }).click();
    await expect(page.locator('.queue-drawer')).toHaveCSS('animation-name', 'none');
    expect(errors).toEqual([]);
  } finally { await app.close(); await rm(profile, { recursive: true, force: true }); }
});
