/// <reference lib="dom" />
import { _electron, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeSilentWav } from '../helpers/audio';
import { mpvProcesses } from '../helpers/mpv-processes';
import type { DesktopApi } from '../../packages/contracts/src/desktop';

test('卸载使用的 SIGTERM 正常退出 Electron 并回收实际 mpv', async () => {
  test.skip(process.platform !== 'linux', 'Linux package removal signal');
  const profile = await mkdtemp(path.join(tmpdir(), 'starsmusic-uninstall-shutdown-'));
  const file = path.join(profile, 'synthetic.wav'); await writeSilentWav(file);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
  env.GSETTINGS_BACKEND = 'memory';
  const desktop = await _electron.launch({ args: ['.', `--user-data-dir=${profile}`], env, chromiumSandbox: true });
  try {
    const page = await desktop.firstWindow();
    await expect(page.getByRole('heading', { name: '音乐库', exact: true })).toBeVisible();
    await desktop.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, file);
    await page.getByRole('button', { name: '选择本地音频', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { starsMusic: DesktopApi }).starsMusic.playback.getState().then(state => state.status))).toBe('playing');
    const child = desktop.process();
    const pid = child.pid!;
    const audio = await mpvProcesses(pid); expect(audio).toHaveLength(1);
    const closed = desktop.waitForEvent('close');
    process.kill(pid, 'SIGTERM'); await closed;
    await expect.poll(() => { try { process.kill(audio[0]!.pid, 0); return true; } catch { return false; } }).toBe(false);
    await expect.poll(() => child.exitCode).toBe(0);
  } finally { await desktop.close(); await rm(profile, { recursive: true, force: true }); }
});
