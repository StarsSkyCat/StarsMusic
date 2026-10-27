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
  const args = ['.', `--user-data-dir=${profile}`, '--password-store=basic'];
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
      await expect(page.getByRole('heading', { name: '音乐库', exact: true })).toBeVisible();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('link', { name: '跳到主内容', exact: true })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.locator('main')).toBeFocused();
      await expect(page.getByRole('navigation', { name: '音乐库', exact: true }).getByRole('button', { name: '音乐库', exact: true })).toHaveAttribute('aria-current', 'page');
      await page.getByRole('button', { name: '正在播放', exact: true }).click();
      await expect(page.getByRole('heading', { name: '还没有正在播放的音乐', exact: true })).toBeVisible();
      await page.getByRole('button', { name: '返回音乐库', exact: true }).click();
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.getByRole('button', { name: '账号与设置', exact: true }).click();
      await page.getByText('应用信息与诊断', { exact: true }).click();
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
      expect(exposure.keys).toEqual(['getAppInfo', 'system', 'appearance', 'playback', 'netease', 'kugou', 'presentation', 'credentials']);
      const metadata = await page.evaluate(async () => {
        const api = (window as unknown as { starsMusic: { presentation: { getState(): Promise<{ status: string; trackId: string | null }> } } }).starsMusic.presentation;
        return { keys: Object.keys(api).sort(), state: await api.getState() };
      });
      expect(metadata.keys).toEqual(['getState', 'onChanged']);
      expect(metadata.state).toMatchObject({ status: 'idle', trackId: null });
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
      expect(kugou.keys).toEqual(provider.keys.filter(key => key !== 'refreshMembership' && key !== 'loadLikes' && key !== 'updateLibrary' && key !== 'refreshLibrary'));
      await expect(page.getByRole('button', { name: '连接酷狗', exact: true })).toBeAttached();
      const credentials = await page.evaluate(async () => {
        const api = (window as unknown as { starsMusic: { credentials: {
          getStatus(): Promise<{ available: boolean; backend: string; remembered: boolean; locked: boolean; savedProviders: string[]; error?: { code: string } }>;
          setRemember(provider: 'netease' | 'kugou', value: boolean): Promise<{ available: boolean; remembered: boolean; error?: { code: string } }>;
          clear(): Promise<{ remembered: boolean; savedProviders: string[] }>;
        } } }).starsMusic.credentials;
        return { keys: Object.keys(api).sort(), initial: await api.getStatus(), enabled: await api.setRemember('kugou', true), cleared: await api.clear() };
      });
      expect(credentials.keys).toEqual(['clear', 'getStatus', 'onChanged', 'setRemember']);
      expect(credentials.initial).toMatchObject({ remembered: false, locked: false });
      expect(credentials.initial.backend).toBe('local-key-aes-256-gcm');
      expect(credentials.initial.available).toBe(true);
      expect(credentials.enabled.remembered).toBe(true);
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
      const defaultSidebar = await page.locator('.sidebar').boundingBox();
      const defaultSettings = await page.getByRole('button', { name: '账号与设置', exact: true }).boundingBox();
      expect(defaultSidebar).not.toBeNull(); expect(defaultSettings).not.toBeNull();
      expect(defaultSettings!.y + defaultSettings!.height).toBeLessThanOrEqual(defaultSidebar!.y + defaultSidebar!.height);
      await page.screenshot({ path: 'artifacts/desktop-default.png' });
      await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(960, 640));
      await page.setViewportSize({ width: 960, height: 640 });
      const sidebarBounds = await page.locator('.sidebar').boundingBox();
      const settingsBounds = await page.getByRole('button', { name: '账号与设置', exact: true }).boundingBox();
      expect(sidebarBounds).not.toBeNull(); expect(settingsBounds).not.toBeNull();
      expect(settingsBounds!.y + settingsBounds!.height).toBeLessThanOrEqual(sidebarBounds!.y + sidebarBounds!.height);
      await page.getByText('应用信息与诊断', { exact: true }).click();
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
      await expect(page.getByRole('heading', { name: '本地队列' })).toBeVisible();
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
      await expect.poll(async () => Number(await page.getByRole('slider', { name: '播放进度' }).inputValue())).toBeGreaterThanOrEqual(4.7);
      await page.getByRole('button', { name: '播放', exact: true }).click();
      await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeEnabled();
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.screenshot({ path: 'artifacts/local-playback.png' });
    });

    await test.step('筛选、多选插队、独立播放页和队列管理共用后台状态', async () => {
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
      await page.getByRole('textbox', { name: '筛选歌曲、歌手或歌单' }).fill('test-');
      await page.getByRole('button', { name: '打开播放页', exact: true }).click();
      const playing = page.getByRole('region', { name: '正在播放', exact: true });
      const controls = page.locator('footer.player');
      await expect(page.getByRole('dialog', { name: 'test-audio.wav', exact: true })).toHaveCount(0);
      await expect(page.getByRole('navigation', { name: '音乐来源', exact: true }).getByRole('button', { name: /^本地音乐/ })).toBeVisible();
      await expect(playing).toBeVisible();
      await expect(page.locator('.breadcrumb strong')).toHaveText('正在播放');
      await expect(playing.getByRole('img')).toBeVisible();
      await expect(playing.getByText('暂无可用歌词', { exact: true })).toBeVisible();
      await page.screenshot({ path: 'artifacts/now-playing-default.png' });
      // 仅注入明确标识的合成 UI 投影，验证歌词/封面渲染；不模拟平台接入或音频成功。
      const metadataState = await page.evaluate(async () => {
        const api = (window as unknown as { starsMusic: { playback: { getState(): Promise<{ generation: number; currentIndex: number; queue: { id: string }[] }> }; presentation: { getState(): Promise<{ revision: number }> } } }).starsMusic;
        const playback = await api.playback.getState();
        return { revision: (await api.presentation.getState()).revision + 1, generation: playback.generation, trackId: playback.queue[playback.currentIndex]!.id, status: 'ready',
          content: { album: '合成测试专辑', artwork: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', lyrics: [{ timeMs: 0, text: '合成第一行' }, { timeMs: 1000, text: '合成第二行' }, ...Array.from({ length: 50 }, (_, index) => ({ timeMs: (10 + index) * 1000, text: `合成后续第${index + 1}行` }))] } };
      });
      await desktop.evaluate(({ BrowserWindow }, snapshot) => BrowserWindow.getAllWindows()[0]!.webContents.send('starsmusic:presentation:changed', snapshot), metadataState);
      await expect(playing.getByText('合成测试专辑', { exact: true })).toBeVisible();
      await expect(playing.locator('.lyric-scroll [aria-current="true"]')).toHaveText('合成第二行');
      await expect(playing.getByRole('img', { name: '当前歌曲专辑封面' })).toBeVisible();
      expect(await playing.getByRole('img', { name: '当前歌曲专辑封面' }).evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      await controls.getByRole('button', { name: '暂停', exact: true }).click();
      await expect(controls.getByRole('button', { name: '播放', exact: true })).toBeEnabled();
      await controls.getByRole('slider', { name: '播放进度' }).fill('0');
      await expect(playing.locator('.lyric-scroll [aria-current="true"]')).toHaveText('合成第一行');
      await controls.getByRole('slider', { name: '播放进度' }).fill('5');
      await expect(playing.locator('.lyric-scroll [aria-current="true"]')).toHaveText('合成第二行');
      await page.setViewportSize({ width: 960, height: 640 });
      await expect(controls.getByRole('button', { name: '播放', exact: true })).toBeInViewport();
      await expect(controls.getByRole('slider', { name: '播放进度' })).toBeInViewport();
      expect(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      await expect(playing.locator('.np-next')).toBeInViewport();
      await page.screenshot({ path: 'artifacts/now-playing-page-minimum.png' });
      await page.setViewportSize({ width: 1280, height: 800 });
      await expect(playing.locator('.np-next')).toBeInViewport();
      await page.screenshot({ path: 'artifacts/now-playing-page.png' });
      await controls.getByRole('slider', { name: '播放进度' }).fill('25.5');
      await expect(playing.locator('.lyric-scroll [aria-current="true"]')).toHaveText('合成后续第16行');
      await playing.getByRole('button', { name: /播放队列/ }).click();
      await expect(page.getByRole('dialog', { name: /播放队列/ })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(playing).toBeVisible();
      const generation = (await state()).generation;
      await page.keyboard.press('Escape');
      await expect(playing).not.toBeVisible();
      await expect(page.getByRole('textbox', { name: '筛选歌曲、歌手或歌单' })).toHaveValue('test-');
      await page.getByRole('button', { name: '打开播放页', exact: true }).click();
      await expect(playing.locator('.lyric-scroll [aria-current="true"]')).toBeInViewport();
      expect((await state()).generation).toBe(generation);
      await playing.getByRole('button', { name: '返回本地音乐', exact: true }).click();
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

test('扫码保存选择按平台隔离，未成功登录的选择不跨应用重启保留', async () => {
  const profile = await mkdtemp(path.join(tmpdir(), 'starsmusic-vault-e2e-'));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
  env.GSETTINGS_BACKEND = 'memory';
  const launch = () => _electron.launch({ args: ['.', `--user-data-dir=${profile}`, '--password-store=basic'], env, chromiumSandbox: true, timeout: 10_000 });
  let desktop: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    desktop = await launch(); let page = await desktop.firstWindow();
    const enabled = await page.evaluate(async () => (window as unknown as { starsMusic: { credentials: { setRemember(provider: 'netease' | 'kugou', value: boolean): Promise<{ available: boolean; remembered: boolean; backend: string }> } } }).starsMusic.credentials.setRemember('kugou', true));
    expect(enabled).toMatchObject({ available: true, remembered: true, backend: 'local-key-aes-256-gcm' });
    await page.getByRole('button', { name: '账号与设置', exact: true }).click();
    // 仅为登录选项布局注入合成等待状态和 1px 图片，不获取/保存真实二维码，不模拟认证成功。
    const waiting = await page.evaluate(async () => {
      const api = (window as unknown as { starsMusic: { kugou: { getState(): Promise<Record<string, unknown>> } } }).starsMusic.kugou;
      return { ...await api.getState(), revision: 100, status: 'waiting-scan', qrImage: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', expiresAt: 9999999999999 };
    });
    await desktop.evaluate(({ BrowserWindow }, snapshot) => BrowserWindow.getAllWindows()[0]!.webContents.send('starsmusic:kugou:state-changed', snapshot), waiting);
    const remember = page.getByRole('checkbox', { name: '记住酷狗音乐登录', exact: true });
    await expect(remember).toBeChecked();
    await remember.uncheck(); await expect(remember).not.toBeChecked();
    await remember.check(); await expect(remember).toBeChecked();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.screenshot({ path: 'artifacts/liquid-glass-synthetic-login.png', animations: 'disabled' });
    const loggedOut = await page.evaluate(async () => {
      const api = (window as unknown as { starsMusic: { kugou: { logout(): Promise<unknown> }; credentials: { getStatus(): Promise<{ rememberedProviders: string[]; savedProviders: string[] }>; setRemember(provider: 'netease', value: boolean): Promise<unknown> } } }).starsMusic;
      await api.credentials.setRemember('netease', true);
      await api.kugou.logout();
      return api.credentials.getStatus();
    });
    expect(loggedOut).toMatchObject({ rememberedProviders: ['netease'], savedProviders: [] });
    await desktop.close(); desktop = undefined;
    desktop = await launch(); page = await desktop.firstWindow();
    const restored = await page.evaluate(async () => (window as unknown as { starsMusic: { credentials: { getStatus(): Promise<{ available: boolean; remembered: boolean; savedProviders: string[] }> } } }).starsMusic.credentials.getStatus());
    expect(restored).toMatchObject({ available: true, remembered: false, savedProviders: [] });
    // 不注入账号、不调用真实登录；平台凭据的加密往返由实际 SQLite/AES 单元测试验证。
    await page.getByRole('button', { name: '账号与设置', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: /记住.*登录/ })).toHaveCount(0);
    await expect(page.getByText('在各平台扫码区域选择「记住登录」。退出账号会自动删除该平台凭据。', { exact: true })).toBeVisible();
    const cleared = await page.evaluate(async () => (window as unknown as { starsMusic: { credentials: { clear(): Promise<{ remembered: boolean; savedProviders: string[] }> } } }).starsMusic.credentials.clear());
    expect(cleared).toMatchObject({ remembered: false, savedProviders: [] });
  } finally { await desktop?.close(); await rm(profile, { recursive: true, force: true }); }
});

test('歌单详情直接展示曲目，往返播放页保留筛选且不显示另一歌单的旧曲目', async () => {
  const profile = await mkdtemp(path.join(tmpdir(), 'starsmusic-navigation-e2e-'));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL; env.GSETTINGS_BACKEND = 'memory';
  const desktop = await _electron.launch({ args: ['.', `--user-data-dir=${profile}`, '--password-store=basic'], env, chromiumSandbox: true, timeout: 10_000 });
  try {
    const page = await desktop.firstWindow();
    await page.setViewportSize({ width: 1280, height: 800 });
    // 明确标识的合成只读 UI 投影；不认证、不播放、不模拟平台请求成功。
    const snapshot = await page.evaluate(async () => {
      const api = (window as unknown as { starsMusic: { kugou: { getState(): Promise<Record<string, unknown>> } } }).starsMusic.kugou;
      return { ...await api.getState(), revision: 100, status: 'connected', account: { id: '4242', nickname: '合成展示账号' }, playlists: [{ id: '1', name: '合成歌单一', trackCount: 1 }, { id: '2', name: '合成歌单二', trackCount: 1 }], playlistId: '1', tracks: [{ id: 'a'.repeat(32), name: '合成展示曲目', artists: ['合成歌手'], durationMs: 30000 }] };
    });
    await desktop.evaluate(({ BrowserWindow }, state) => BrowserWindow.getAllWindows()[0]!.webContents.send('starsmusic:kugou:state-changed', state), snapshot);
    await page.getByRole('button', { name: /合成歌单一/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: '合成歌单一', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '播放 合成展示曲目', exact: true })).toBeVisible();
    await expect(page.locator('.playlist-grid')).toHaveCount(0);
    await page.screenshot({ path: 'artifacts/liquid-glass-synthetic-playlist-detail.png', animations: 'disabled' });
    const search = page.getByRole('textbox', { name: '筛选歌曲、歌手或歌单', exact: true });
    await search.fill('合成展示');
    await page.getByRole('button', { name: '正在播放', exact: true }).click();
    await expect(page.getByRole('region', { name: '正在播放', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '返回酷狗音乐', exact: true }).click();
    await expect(search).toHaveValue('合成展示');
    await expect(page.getByRole('heading', { level: 1, name: '合成歌单一', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '返回全部歌单', exact: true }).click();
    await expect(search).toHaveCount(0);
    await page.screenshot({ path: 'artifacts/liquid-glass-synthetic-playlists.png', animations: 'disabled' });
    await page.getByRole('button', { name: /合成歌单二/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: '合成歌单二', exact: true })).toBeVisible();
    await expect(search).toHaveValue('');
    await expect(page.getByRole('button', { name: '播放 合成展示曲目', exact: true })).toHaveCount(0);
  } finally { await desktop.close(); await rm(profile, { recursive: true, force: true }); }
});
