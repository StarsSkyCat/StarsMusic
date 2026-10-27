/// <reference lib="dom" />
import { _electron, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import dbus from 'dbus-next';
import type { DesktopApi } from '../../packages/contracts/src/desktop';
import { createBus, sessionAddress, call } from '../../packages/desktop/src/linux/bus';
import { mprisPath, mprisPlayer } from '../../packages/desktop/src/linux/mpris';
import { isolatedSessionBus } from '../helpers/isolated-bus';
import { writeSilentWav } from '../helpers/audio';

test('真实 Electron/mpv：UI 与 MPRIS 双向模式同步、暂停切歌、双主题布局及重启保存', async () => {
  test.setTimeout(45000);
  const profile = await mkdtemp('/tmp/starsmusic-modes-e2e-');
  const isolated = await isolatedSessionBus(profile);
  const client = createBus(sessionAddress({ DBUS_SESSION_BUS_ADDRESS: isolated.address }, process.getuid?.()));
  client.on('error', () => undefined);
  const files = ['合成模式 A.wav', '合成模式 B.wav', '合成模式 C.wav'].map(file => path.join(profile, file));
  await Promise.all(files.map(file => writeSilentWav(file)));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
  env.DBUS_SESSION_BUS_ADDRESS = isolated.address; env.GSETTINGS_BACKEND = 'memory';
  const launch = () => _electron.launch({ args: ['.', `--user-data-dir=${profile}`, '--password-store=basic'], env, chromiumSandbox: true });
  let app: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    app = await launch(); let page = await app.firstWindow(); page.setDefaultTimeout(5000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByRole('heading', { name: '音乐库', exact: true })).toBeVisible();
    const state = () => page.evaluate(() => (window as unknown as { starsMusic: DesktopApi }).starsMusic.playback.getState());
    let name = '';
    await expect.poll(async () => {
      const system = await page.evaluate(() => (window as unknown as { starsMusic: DesktopApi }).starsMusic.system.getState());
      name = system.mprisName ?? ''; return system.mpris.state;
    }).toBe('available');
    const get = async (key: string) => ((await call(client, name, mprisPath, 'org.freedesktop.DBus.Properties', 'Get', 'ss', [mprisPlayer, key]))[0] as dbus.Variant).value as unknown;
    const set = (key: string, value: dbus.Variant) => call(client, name, mprisPath, 'org.freedesktop.DBus.Properties', 'Set', 'ssv', [mprisPlayer, key, value]);
    // 只替代原生文件选择器；音频、模式状态、MPRIS 和 SQLite 都使用真实实现。
    await app.evaluate(({ dialog }, files) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files }); }, files);
    await page.getByRole('button', { name: '选择本地音频', exact: true }).click();
    await expect.poll(async () => (await state()).status).toBe('playing');
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    await expect.poll(async () => (await state()).status).toBe('paused');
    await page.getByRole('slider', { name: '播放进度', exact: true }).fill('5');
    await expect.poll(async () => (await state()).positionSeconds).toBeGreaterThan(4.8);
    const initial = await state(); const currentId = initial.queue[initial.currentIndex!]!.id;
    await page.getByRole('button', { name: '顺序播放', exact: true }).click();
    await expect(page.getByRole('button', { name: '列表循环', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(await get('LoopStatus')).toBe('Playlist');
    await page.getByRole('button', { name: '列表循环', exact: true }).click();
    await expect(page.getByRole('button', { name: '单曲循环', exact: true })).toBeVisible(); expect(await get('LoopStatus')).toBe('Track');
    await page.getByRole('button', { name: '单曲循环', exact: true }).click();
    await expect(page.getByRole('button', { name: '顺序播放', exact: true })).toHaveAttribute('aria-pressed', 'false'); expect(await get('LoopStatus')).toBe('None');
    await page.getByRole('button', { name: '随机播放', exact: true }).click();
    await expect(page.getByRole('button', { name: '随机播放', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(await get('Shuffle')).toBe(true);
    const shuffled = await state(); expect(shuffled.generation).toBe(initial.generation); expect(shuffled.queue[shuffled.currentIndex!]!.id).toBe(currentId);
    expect(shuffled.status).toBe('paused'); expect(Math.abs(shuffled.positionSeconds - initial.positionSeconds)).toBeLessThan(.2);
    expect([...shuffled.queue.map(track => track.id)].sort()).toEqual([...initial.queue.map(track => track.id)].sort());
    await set('Shuffle', new dbus.Variant('b', false));
    await expect(page.getByRole('button', { name: '随机播放', exact: true })).toHaveAttribute('aria-pressed', 'false');
    expect((await state()).queue).toEqual(initial.queue);
    await set('LoopStatus', new dbus.Variant('s', 'Playlist'));
    await expect(page.getByRole('button', { name: '列表循环', exact: true })).toBeVisible();
    await call(client, name, mprisPath, mprisPlayer, 'Previous');
    await expect.poll(async () => (await state()).currentIndex).toBe(2);
    await expect.poll(async () => (await state()).status).toBe('paused');
    await call(client, name, mprisPath, mprisPlayer, 'Next');
    await expect.poll(async () => (await state()).currentIndex).toBe(0);
    await expect.poll(async () => (await state()).status).toBe('paused');
    await set('Shuffle', new dbus.Variant('b', true)); await set('LoopStatus', new dbus.Variant('s', 'Track'));
    await expect(page.getByRole('button', { name: '单曲循环', exact: true })).toBeVisible();
    for (const theme of ['浅色', '暗色']) {
      await page.getByRole('button', { name: '账号与设置', exact: true }).click();
      await page.getByRole('radio', { name: theme, exact: true }).check();
      for (const width of [960, 1150, 1241, 1440]) {
        await page.setViewportSize({ width, height: 800 });
        const geometry = await page.locator('.transport').evaluate(node => {
          const controls = Array.from(node.querySelectorAll('button')).map(button => button.getBoundingClientRect());
          return { overlap: controls.some((bounds, i) => i > 0 && bounds.left < controls[i - 1]!.right),
            overflow: controls[0]!.left < node.getBoundingClientRect().left || controls.at(-1)!.right > node.getBoundingClientRect().right };
        });
        expect(geometry).toEqual({ overlap: false, overflow: false });
      }
      await page.screenshot({ path: `artifacts/playback-modes-${theme === '浅色' ? 'light' : 'dark'}.png`, animations: 'disabled' });
    }
    await page.getByRole('button', { name: '正在播放', exact: true }).click();
    await expect(page.locator('.np-next strong')).toHaveText((await state()).queue[0]!.title);
    const before = await state();
    await app.close(); app = undefined; app = await launch(); page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: '音乐库', exact: true })).toBeVisible();
    const after = await state(); expect(after.status).toBe('paused'); expect(after.shuffle).toBe(true); expect(after.loopMode).toBe('track');
    expect(after.queue).toEqual(before.queue); expect(after.currentIndex).toBe(before.currentIndex); expect(after.engineVersion).toBeUndefined();
    await expect(page.getByRole('button', { name: '随机播放', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: '单曲循环', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '随机播放', exact: true }).click();
    await expect.poll(async () => (await state()).shuffle).toBe(false); expect((await state()).queue).toEqual(initial.queue);
  } finally { await app?.close(); client.disconnect(); await isolated.close(); await rm(profile, { recursive: true, force: true }); }
});
