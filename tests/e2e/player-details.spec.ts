/// <reference lib="dom" />
import { _electron, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { playbackChannels } from '../../packages/contracts/src/playback';

test('双主题底栏完整显示播放权限和音质，缩放后不挤压音量或队列', async () => {
  const profile = await mkdtemp(path.join(tmpdir(), 'starsmusic-player-details-e2e-'));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL; env.GSETTINGS_BACKEND = 'memory';
  const app = await _electron.launch({ args: ['.', `--user-data-dir=${profile}`, '--password-store=basic'], env, chromiumSandbox: true });
  try {
    const page = await app.firstWindow(); page.setDefaultTimeout(5000);
    await expect(page.getByRole('heading', { name: '音乐库', exact: true })).toBeVisible();
    // 只投影合成的暂停状态以验证布局，不认证、不请求平台、不启动音频。
    await app.evaluate(({ BrowserWindow }, channel) => {
      BrowserWindow.getAllWindows()[0]!.webContents.send(channel, {
        revision: 100, generation: 50, status: 'paused', currentIndex: 0,
        queue: [{ id: 'synthetic-layout', title: '合成底栏布局歌曲', artist: '合成歌手', provider: 'netease', sourceId: '700', detail: '完整播放 · 音质未知' }],
        positionSeconds: 116, durationSeconds: 270, volume: 100, muted: false,
      });
    }, playbackChannels.stateChanged);
    const player = page.getByRole('contentinfo', { name: '播放状态' });
    const label = player.locator('.quality-label');
    for (const theme of ['浅色', '暗色']) {
      await page.getByRole('button', { name: '账号与设置', exact: true }).click();
      const radio = page.getByRole('radio', { name: theme, exact: true });
      await radio.check(); await expect(radio).toBeEnabled();
      for (const width of [960, 1150, 1151, 1241, 1280, 1440]) {
        await page.setViewportSize({ width, height: 800 });
        await expect(label).toBeVisible();
        await expect(label).toHaveText('完整播放 · 音质未知');
        const geometry = await player.evaluate(node => {
          const label = node.querySelector<HTMLElement>('.quality-label')!;
          const volume = node.querySelector('.volume-control')!.getBoundingClientRect();
          const queue = node.querySelector('.queue-toggle')!.getBoundingClientRect();
          const controls = node.querySelector('.playback-controls')!.getBoundingClientRect();
          const song = node.querySelector('.now-playing')!.getBoundingClientRect();
          const bounds = label.getBoundingClientRect();
          return { clipped: label.scrollWidth > label.clientWidth, overflow: node.scrollWidth - node.clientWidth,
            songRight: song.right, controlsLeft: controls.left, controlsRight: controls.right, labelLeft: bounds.left,
            labelRight: bounds.right, volumeLeft: volume.left, volumeRight: volume.right, queueLeft: queue.left,
            queueRight: queue.right, playerRight: node.getBoundingClientRect().right };
        });
        expect(geometry.clipped).toBe(false);
        expect(geometry.overflow).toBeLessThanOrEqual(1);
        expect(geometry.songRight).toBeLessThanOrEqual(geometry.controlsLeft);
        expect(geometry.controlsRight).toBeLessThanOrEqual(geometry.labelLeft);
        expect(geometry.labelRight).toBeLessThanOrEqual(geometry.volumeLeft);
        expect(geometry.volumeRight).toBeLessThanOrEqual(geometry.queueLeft);
        expect(geometry.queueRight).toBeLessThan(geometry.playerRight);
        if (width === 1241) await page.screenshot({ path: `artifacts/player-details-synthetic-${theme === '浅色' ? 'light' : 'dark'}.png`, animations: 'disabled' });
      }
    }
  } finally { await app.close(); await rm(profile, { recursive: true, force: true }); }
});
