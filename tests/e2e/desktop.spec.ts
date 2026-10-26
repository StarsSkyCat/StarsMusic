/// <reference lib="dom" />
import { _electron, expect, test } from '@playwright/test';
import { mkdtemp, readFile, readlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeSilentWav } from '../helpers/audio';

test('桌面窗口、实际 IPC、沙箱隔离、弹窗与导航阻断及退出', async () => {
  const profile = await mkdtemp(path.join(tmpdir(), 'starsmusic-e2e-'));
  const audioFile = path.join(profile, 'test-audio.wav');
  const secondFile = path.join(profile, 'test-second.wav');
  const thirdFile = path.join(profile, 'test-third.wav');
  await Promise.all([writeSilentWav(audioFile), writeSilentWav(secondFile), writeSilentWav(thirdFile)]);
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
    let mpvPid: number | undefined;
    const page = await desktop.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await test.step('页面与真实 IPC', async () => {
      await expect(page.getByRole('heading', { name: /让喜欢的音乐/ })).toBeVisible();
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.getByRole('button', { name: '账号与设置', exact: true }).click();
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
      expect(exposure.keys).toEqual(['getAppInfo', 'playback', 'netease', 'kugou', 'credentials']);
      expect(exposure.info).toMatchObject({ name: 'StarsMusic', version: '0.0.0' });
      expect([exposure.require, exposure.process, exposure.ipcRenderer]).toEqual(['undefined', 'undefined', 'undefined']);
      await expect(page.getByRole('button', { name: '连接网易云', exact: true })).toBeVisible();
      // 仅验证真实 utilityProcess 启动与临时退出，不自动生成/截图真实登录二维码。
      const provider = await page.evaluate(async () => {
        const api = (window as unknown as { starsMusic: { netease: { getState(): Promise<{ status: string }>; logout(): Promise<{ status: string }> } } }).starsMusic.netease;
        const state = await api.getState();
        const loggedOut = await api.logout();
        return { keys: Object.keys(api).sort(), status: state.status, loggedOut: loggedOut.status };
      });
      expect(provider.status).toBe('signed-out'); expect(provider.loggedOut).toBe('signed-out');
      expect(provider.keys).not.toContain('resolveTrack'); expect(provider.keys).not.toContain('request');
      const kugou = await page.evaluate(async () => {
        const api = (window as unknown as { starsMusic: { kugou: { getState(): Promise<{ status: string }>; logout(): Promise<{ status: string }> } } }).starsMusic.kugou;
        return { initial: (await api.getState()).status, logout: (await api.logout()).status, keys: Object.keys(api).sort() };
      });
      expect(kugou.initial).toBe('signed-out'); expect(kugou.logout).toBe('signed-out');
      expect(kugou.keys).toEqual(provider.keys);
      await expect(page.getByRole('button', { name: '连接酷狗', exact: true })).toBeAttached();
      const credentials = await page.evaluate(async () => {
        const api = (window as unknown as { starsMusic: { credentials: {
          getStatus(): Promise<{ available: boolean; backend: string; remembered: boolean; locked: boolean; savedProviders: string[]; error?: { code: string } }>;
          setRemember(value: boolean): Promise<{ available: boolean; remembered: boolean; error?: { code: string } }>;
          clear(): Promise<{ remembered: boolean; savedProviders: string[] }>;
        } } }).starsMusic.credentials;
        return { keys: Object.keys(api).sort(), initial: await api.getStatus(), enabled: await api.setRemember(true), cleared: await api.clear() };
      });
      expect(credentials.keys).toEqual(['clear', 'getStatus', 'onChanged', 'setRemember']);
      expect(credentials.initial).toMatchObject({ remembered: false, locked: false });
      expect(typeof credentials.initial.backend).toBe('string');
      if (!credentials.initial.available) {
        expect(credentials.enabled.available).toBe(false);
        expect(credentials.enabled.remembered).toBe(false);
        expect(credentials.enabled.error?.code).toBe('credential-unavailable');
      }
      expect(credentials.cleared.remembered).toBe(false); expect(credentials.cleared.savedProviders).toEqual([]);
      await page.getByRole('button', { name: '音乐库', exact: true }).click();
      await page.screenshot({ path: 'artifacts/music-library.png' });
      await page.getByRole('button', { name: '账号与设置', exact: true }).click();

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

    await test.step('选择本地文件、实际音频解码、暂停、定位、恢复与退出', async () => {
      // 只替代原生选择器交互，仍使用实际 mpv 与系统音频输出，无播放成功 Mock。
      await desktop.evaluate(({ dialog }, filenames) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: filenames });
      }, [audioFile, secondFile, thirdFile]);
      await page.getByRole('button', { name: '音乐库', exact: true }).click();
      await page.getByRole('button', { name: '选择本地音频', exact: true }).click();
      await expect(page.getByRole('heading', { name: '本次导入' })).toBeVisible();
      await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeEnabled();
      const desktopPid = desktop.process().pid!;
      const children = (await readFile(`/proc/${desktopPid}/task/${desktopPid}/children`, 'utf8')).trim().split(/\s+/);
      for (const pid of children) {
        try { if ((await readlink(`/proc/${pid}/exe`)).endsWith('/mpv')) mpvPid = Number(pid); } catch { /* 已退出 */ }
      }
      expect(mpvPid).toBeDefined();
      const output = await page.evaluate(async () => {
        const api = (window as unknown as { starsMusic: { playback: { getState(): Promise<{ audioOutput?: string }> } } }).starsMusic;
        return (await api.playback.getState()).audioOutput;
      });
      expect(output).toBeTruthy();
      expect(output).not.toBe('null');
      console.log(`实际系统音频输出：${output}`);
      await page.getByRole('button', { name: '暂停', exact: true }).click();
      await expect(page.getByRole('button', { name: '播放', exact: true })).toBeEnabled();
      await page.getByRole('slider', { name: '播放进度' }).fill('5');
      await expect.poll(async () => Number(await page.getByRole('slider', { name: '播放进度' }).inputValue())).toBeGreaterThanOrEqual(4.9);
      await page.getByRole('button', { name: '播放', exact: true }).click();
      await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeEnabled();
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.screenshot({ path: 'artifacts/local-playback.png' });
    });

    await test.step('筛选、多选插队、展开播放页和队列管理共用后台状态', async () => {
      const state = () => page.evaluate(async () => {
        const api = (window as unknown as { starsMusic: { playback: { getState(): Promise<{ generation: number; currentIndex: number | null; queue: { title: string }[] }> } } }).starsMusic.playback;
        return api.getState();
      });
      const before = await state();
      await page.getByRole('textbox', { name: '筛选歌曲、歌手或歌单' }).fill('third');
      await expect(page.getByRole('button', { name: '播放 test-third.wav', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '播放 test-second.wav', exact: true })).toHaveCount(0);
      await page.getByRole('textbox', { name: '筛选歌曲、歌手或歌单' }).fill('');
      await page.getByRole('checkbox', { name: '选择 test-second.wav', exact: true }).check();
      await page.getByRole('checkbox', { name: '选择 test-third.wav', exact: true }).check();
      await page.getByRole('button', { name: '下一首播放', exact: true }).click();
      expect((await state()).generation).toBe(before.generation);
      expect((await state()).queue.map(t => t.title)).toEqual(['test-audio.wav', 'test-second.wav', 'test-third.wav']);
      await page.getByRole('button', { name: '下一首播放 test-third.wav', exact: true }).click();
      expect((await state()).queue.map(t => t.title)).toEqual(['test-audio.wav', 'test-third.wav', 'test-second.wav']);
      expect((await state()).generation).toBe(before.generation);
      await page.getByRole('button', { name: '展开播放页', exact: true }).click();
      const playing = page.getByRole('dialog', { name: 'test-audio.wav', exact: true });
      await expect(playing).toBeVisible();
      await expect(playing.getByRole('img')).toBeVisible();
      await playing.getByRole('button', { name: '暂停', exact: true }).click();
      await expect(playing.getByRole('button', { name: '播放', exact: true })).toBeEnabled();
      await page.screenshot({ path: 'artifacts/expanded-player.png' });
      await playing.press('Escape');
      await expect(playing).not.toBeVisible();
      await page.getByRole('button', { name: '打开播放队列', exact: true }).click();
      const queue = page.getByRole('dialog', { name: /播放队列/ });
      await expect(queue).toBeVisible();
      await expect(queue.getByRole('list', { name: '全部队列歌曲' }).getByRole('listitem')).toHaveCount(3);
      await queue.getByRole('button', { name: /test-second.wav.*待播放/ }).click();
      await expect(queue.getByRole('list', { name: '全部队列歌曲' }).getByRole('listitem')).toHaveCount(3);
      await expect(queue.getByRole('button', { name: /test-audio.wav.*已播放/ })).toBeVisible();
      await queue.getByRole('button', { name: /test-audio.wav.*已播放/ }).click();
      await page.screenshot({ path: 'artifacts/play-next-queue.png' });
      await queue.getByRole('button', { name: '移除 test-second.wav', exact: true }).click();
      expect((await state()).queue.map(t => t.title)).toEqual(['test-audio.wav', 'test-third.wav']);
      await queue.getByRole('button', { name: '清空后续', exact: true }).click();
      expect((await state()).queue.map(t => t.title)).toEqual(['test-audio.wav']);
      await queue.getByRole('button', { name: '关闭播放队列', exact: true }).click();
      await page.setViewportSize({ width: 960, height: 640 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: 'artifacts/local-playback-minimum.png' });
      expect(errors).toEqual([]);
    });

    await test.step('拒绝主文档导航', async () => {
      const originalUrl = page.url();
      await page.evaluate(() => { window.location.href = 'https://example.invalid/'; });
      expect(await page.evaluate(() => window.location.href)).toBe(originalUrl);
      // Chromium 已取消导航；直接检查原文档，避免 Playwright 等待一个已被取消的导航。
      expect(await page.evaluate(() => document.querySelector('h1')?.textContent)).toContain('本地音乐');
    });

    await test.step('关闭窗口退出', async () => {
      if (process.platform !== 'darwin') {
        const closed = desktop.waitForEvent('close');
        await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
        await closed;
        expect(() => process.kill(mpvPid!, 0)).toThrow();
      }
    });
  } finally {
    await desktop.close();
    await rm(profile, { recursive: true, force: true });
  }
});
