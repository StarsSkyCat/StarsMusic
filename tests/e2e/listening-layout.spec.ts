/// <reference lib="dom" />
import { _electron, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeSilentWav } from '../helpers/audio';
import type { DesktopApi } from '../../packages/contracts/src/desktop';

test('双主题播放舞台填满高窗口，缩放后歌词居中且底栏与下一首始终可用', async () => {
  const profile = await mkdtemp(path.join(tmpdir(), 'starsmusic-stage-e2e-'));
  const audio = path.join(profile, '合成布局验证.wav'); await writeSilentWav(audio);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL; env.GSETTINGS_BACKEND = 'memory';
  const desktop = await _electron.launch({ args: ['.', `--user-data-dir=${profile}`, '--password-store=basic'], env, chromiumSandbox: true });
  try {
    const page = await desktop.firstWindow(); await page.setViewportSize({ width: 1280, height: 800 });
    const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
    await desktop.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, audio);
    await page.getByRole('button', { name: '选择本地音频', exact: true }).click();
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    // 音频由真实 mpv 解码；仅歌词是明确标识的合成 UI 投影，未认证或请求平台。
    const metadata = await page.evaluate(async () => {
      const api = (window as unknown as { starsMusic: DesktopApi }).starsMusic;
      const playback = await api.playback.getState();
      return { revision: (await api.presentation.getState()).revision + 1, generation: playback.generation,
        trackId: playback.queue[playback.currentIndex!]!.id, status: 'ready',
        content: { album: '合成界面验证 · 默认原创封面', lyrics: Array.from({ length: 40 }, (_, index) => ({ timeMs: index * 1000, text: `合成歌词 · 第 ${index + 1} 行` })) } };
    });
    await desktop.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0]!.webContents.send('starsmusic:presentation:changed', value), metadata);
    await page.getByRole('slider', { name: '播放进度', exact: true }).fill('12');
    const playing = page.getByRole('region', { name: '正在播放', exact: true });
    for (const theme of ['light', 'dark'] as const) {
      await page.getByRole('button', { name: '账号与设置', exact: true }).click();
      const radio = page.getByRole('radio', { name: theme === 'light' ? '浅色' : '暗色', exact: true });
      await radio.check(); await expect(radio).toBeEnabled();
      await page.getByRole('button', { name: '正在播放', exact: true }).click();
      await expect(playing.locator('[aria-current="true"]')).toHaveText('合成歌词 · 第 13 行');
      for (const size of [{ width: 960, height: 640 }, { width: 1280, height: 800 }, { width: 1240, height: 1260 }, { width: 1440, height: 1000 }]) {
        await page.setViewportSize(size);
        await expect(playing.locator('.np-next')).toBeInViewport();
        await expect(page.getByRole('slider', { name: '播放进度', exact: true })).toBeInViewport();
        await expect.poll(() => playing.evaluate((element) => {
          const row = element.querySelector<HTMLElement>('.lyric-scroll [aria-current="true"]')!;
          const scroll = element.querySelector<HTMLElement>('.lyric-scroll')!;
          return Math.abs(row.getBoundingClientRect().top + row.clientHeight / 2
            - scroll.getBoundingClientRect().top - scroll.clientHeight / 2);
        })).toBeLessThan(4);
        await expect.poll(() => page.locator('main').evaluate(node => node.scrollHeight - node.clientHeight)).toBeLessThanOrEqual(1);
        const geometry = await playing.evaluate((element) => {
          const pane = element.querySelector('.np-lyric-pane')!.getBoundingClientRect();
          const next = element.querySelector('.np-next')!.getBoundingClientRect();
          const main = element.closest('main')!;
          return { bottomGap: element.getBoundingClientRect().bottom - next.bottom,
            lyricGap: next.top - pane.bottom, overflow: main.scrollHeight - main.clientHeight,
            horizontalOverflow: main.scrollWidth - main.clientWidth, height: pane.height };
        });
        expect(geometry.bottomGap).toBeLessThan(2);
        expect(geometry.lyricGap).toBeLessThanOrEqual(24);
        expect(geometry.overflow).toBeLessThanOrEqual(1);
        expect(geometry.horizontalOverflow).toBeLessThanOrEqual(1);
        if (size.height === 1260) expect(geometry.height).toBeGreaterThan(800);
        if (size.height !== 1000)
          await page.screenshot({ path: `artifacts/listening-${theme}-${size.height === 1260 ? 'tall' : size.height === 640 ? 'minimum' : 'desktop'}.png`, animations: 'disabled' });
      }
    }
    const after = await page.evaluate(async () => (window as unknown as { starsMusic: DesktopApi }).starsMusic.playback.getState());
    expect(after.generation).toBe(metadata.generation); expect(after.status).toBe('paused');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('slider', { name: '播放进度', exact: true }).fill('20');
    await expect(playing.locator('.lyric-scroll [aria-current="true"]')).toHaveText('合成歌词 · 第 21 行');
    expect(errors).toEqual([]);
  } finally { await desktop.close(); await rm(profile, { recursive: true, force: true }); }
});
