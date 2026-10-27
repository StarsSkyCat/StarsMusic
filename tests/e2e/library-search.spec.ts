/// <reference lib="dom" />
import { _electron, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { initialNeteaseSnapshot, neteaseChannels } from '../../packages/contracts/src/netease';
import { initialKugouSnapshot, kugouChannels } from '../../packages/contracts/src/kugou';
import { playbackChannels } from '../../packages/contracts/src/playback';

test('音乐库全来源搜索：独立失败/分页、旧响应、播放来源、歌单导航及移除队列列表', async () => {
  const profile = await mkdtemp('/tmp/starsmusic-library-search-e2e-');
  const env: Record<string, string> = {}; for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL; env.GSETTINGS_BACKEND = 'memory';
  const app = await _electron.launch({ args: ['.', `--user-data-dir=${profile}`, '--password-store=basic'], env, chromiumSandbox: true });
  try {
    const page = await app.firstWindow(); page.setDefaultTimeout(5000); await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.getByRole('heading', { name: '音乐库', exact: true })).toBeVisible();
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    // 明确的合成 UI 快照与命令捕获，不使用账号凭据、不模拟真实平台播放成功。
    await app.evaluate(({ ipcMain, BrowserWindow }, { netease, kugou, playback, neInitial, kgInitial }) => {
      type Provider = 'netease' | 'kugou';
      const states: Record<Provider, Record<string, unknown>> = {
        netease: { ...neInitial, revision: 100, generation: 50 }, kugou: { ...kgInitial, revision: 100, generation: 50 },
      };
      const channels = { netease, kugou }; const calls: Record<string, unknown>[] = []; const late: (() => void)[] = [];
      Reflect.set(globalThis, '__librarySearchCalls', calls); Reflect.set(globalThis, '__librarySearchLate', () => late.splice(0).forEach(resolve => resolve()));
      const publish = (provider: Provider) => {
        states[provider] = { ...states[provider], revision: Number(states[provider].revision) + 1 };
        BrowserWindow.getAllWindows()[0]!.webContents.send(channels[provider].stateChanged, states[provider]); return states[provider];
      };
      for (const provider of ['netease', 'kugou'] as const) {
        const channel = channels[provider];
        for (const key of [channel.browse, channel.getArtwork, channel.loadPlaylists, channel.loadPlaylist, channel.playTrack, channel.enqueueNext]) ipcMain.removeHandler(key);
        ipcMain.handle(channel.getArtwork, () => null);
        ipcMain.handle(channel.loadPlaylists, () => publish(provider));
        ipcMain.handle(channel.loadPlaylist, (_event, id: string) => { calls.push({ provider, operation: 'owned', id }); states[provider] = { ...states[provider], playlistId: id, tracks: [{ id: provider === 'netease' ? '7' : 'a'.repeat(32), name: '合成私人曲目', artists: ['合成歌手'], durationMs: 30000 }] }; return publish(provider); });
        ipcMain.handle(channel.playTrack, (_event, id: string) => { calls.push({ provider, operation: 'play', id }); });
        ipcMain.handle(channel.enqueueNext, (_event, id: string) => { calls.push({ provider, operation: 'next', id }); });
        ipcMain.handle(channel.browse, async (_event, request: { kind: string; query?: string; searchType?: string; id?: string; offset: number }) => {
          calls.push({ provider, ...request });
          const previous = states[provider].catalog as Record<string, unknown>;
          const query = request.query ?? previous.query;
          const failure = provider === 'kugou' && query === '一路失败' && Reflect.get(globalThis, '__libraryKugouRecovered') !== true;
          const empty = query === '空结果';
          const catalog = { ...previous, kind: request.kind, query, searchType: request.searchType ?? previous.searchType, offset: request.offset, status: failure ? 'error' : 'ready', tracks: [], playlists: [], total: 0, more: false, playlist: undefined, error: undefined,
            ...(failure ? { error: { code: 'network', message: '合成酷狗网络连接失败', retryable: true } } : !empty && request.kind === 'search' ? {
              total: 31, more: request.offset === 0,
              ...(request.searchType === 'songs' ? { tracks: Array.from({ length: provider === 'kugou' && request.offset === 0 ? 2 : 1 }, (_, i) => ({ id: provider === 'netease' ? '7' : (i ? 'b' : 'a').repeat(32), name: `${provider === 'netease' ? '网易云' : '酷狗'}合成 ${query} ${request.offset + i + 1}`, artists: ['合成歌手'], durationMs: 30000, rights: { fee: 'vip', playback: 'unknown' } })) }
                : { playlists: [{ id: provider === 'netease' ? '91' : 'collection_synthetic', name: `${provider === 'netease' ? '网易云' : '酷狗'}合成公开歌单`, trackCount: 1 }] }),
            } : request.kind === 'playlist' ? { total: 1, playlist: { id: request.id, name: '合成公开歌单详情', trackCount: 1 }, tracks: [{ id: provider === 'netease' ? '7' : 'a'.repeat(32), name: '合成公开曲目', artists: ['合成歌手'], durationMs: 30000 }] } : {}),
          };
          const next = { ...states[provider], revision: Number(states[provider].revision) + 1, catalog };
          if (query === '慢请求') return new Promise(resolve => { late.push(() => resolve(next)); });
          states[provider] = next; return publish(provider);
        });
        publish(provider);
      }
      Reflect.set(globalThis, '__libraryConnect', () => {
        for (const provider of ['netease', 'kugou'] as const) {
          states[provider] = { ...states[provider], status: 'connected', generation: 51, account: { id: '42', nickname: '合成账号' }, playlists: [{ id: '11', name: `${provider}合成私人歌单`, trackCount: 1 }] }; publish(provider);
        }
      });
      for (const key of [playback.playTrack, playback.moveNext]) ipcMain.removeHandler(key);
      ipcMain.handle(playback.playTrack, (_event, id: string) => { calls.push({ provider: 'local', operation: 'play', id }); return parked; });
      ipcMain.handle(playback.moveNext, (_event, id: string) => { calls.push({ provider: 'local', operation: 'next', id }); return parked; });
      const parked = { revision: 1000, generation: 50, status: 'paused', queue: [{ id: 'local-one', title: '合成本地歌曲', provider: 'local' }, { id: 'remote-one', title: '合成在线队列曲目', provider: 'netease', sourceId: '8' }], currentIndex: 0, positionSeconds: 0, durationSeconds: 30, volume: 70, muted: false, loopMode: 'playlist', shuffle: false };
      BrowserWindow.getAllWindows()[0]!.webContents.send(playback.stateChanged, parked);
    }, { netease: neteaseChannels, kugou: kugouChannels, playback: playbackChannels, neInitial: initialNeteaseSnapshot(), kgInitial: initialKugouSnapshot() });
    const calls = () => app.evaluate(() => Reflect.get(globalThis, '__librarySearchCalls') as Record<string, unknown>[]);
    const input = page.getByRole('searchbox', { name: '搜索全部音乐来源', exact: true });
    const results = page.getByRole('region', { name: '全部来源搜索结果', exact: true });
    const ne = results.getByRole('region', { name: '网易云音乐搜索结果', exact: true });
    const kg = results.getByRole('region', { name: '酷狗音乐搜索结果', exact: true });
    await expect(page.getByRole('heading', { name: '当前播放队列', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '播放 合成在线队列曲目', exact: true })).toHaveCount(0);
    await input.fill('合成'); expect((await calls()).length).toBe(0); await input.press('Enter');
    await expect(results.getByRole('region', { name: '本地音乐搜索结果', exact: true }).locator('.song-list li')).toHaveCount(1);
    await expect(ne.locator('.song-list li')).toHaveCount(1); await expect(kg.locator('.song-list li')).toHaveCount(2);
    await expect(ne.locator('.track-fee')).toHaveText('VIP');
    await results.getByRole('navigation', { name: '搜索来源', exact: true }).getByRole('button', { name: /^酷狗音乐/ }).click();
    await expect(kg.getByRole('heading', { level: 2 })).toBeFocused();
    await page.keyboard.press('/'); await expect(input).toBeFocused();
    await ne.getByRole('button', { name: '播放 网易云合成 合成 1', exact: true }).click(); await expect(ne.getByRole('alert')).toContainText('先连接');
    expect((await calls()).some(call => call.operation === 'play')).toBe(false);
    const neCount = (await calls()).filter(call => call.provider === 'netease' && call.kind === 'search').length;
    await kg.getByRole('navigation', { name: '酷狗音乐搜索分页', exact: true }).getByRole('button', { name: '下一页', exact: true }).click();
    await expect(kg.getByRole('button', { name: '播放 酷狗合成 合成 31', exact: true })).toBeVisible();
    expect((await calls()).filter(call => call.provider === 'netease' && call.kind === 'search').length).toBe(neCount);
    const beforePlaying = (await calls()).length;
    await page.getByRole('button', { name: '正在播放', exact: true }).click();
    await page.getByRole('button', { name: '返回音乐库', exact: true }).click();
    await expect(kg.getByRole('button', { name: '播放 酷狗合成 合成 31', exact: true })).toBeVisible();
    expect((await calls()).length).toBe(beforePlaying);
    await input.fill('一路失败'); await input.press('Enter'); await expect(kg.getByRole('alert')).toContainText('网络连接失败'); await expect(ne.locator('.song-list li')).toHaveCount(1);
    await app.evaluate(() => Reflect.set(globalThis, '__libraryKugouRecovered', true));
    await kg.getByRole('button', { name: '重试酷狗音乐', exact: true }).click(); await expect(kg.locator('.song-list li')).toHaveCount(2);
    await input.fill('慢请求'); await input.press('Enter');
    await expect.poll(async () => (await calls()).filter(call => call.query === '慢请求').length).toBe(2);
    await input.fill('合成新'); await input.press('Enter'); await expect(ne.getByRole('button', { name: '播放 网易云合成 合成新 1', exact: true })).toBeVisible();
    await app.evaluate(() => { (Reflect.get(globalThis, '__librarySearchLate') as () => void)(); });
    await expect(ne.getByRole('button', { name: '播放 网易云合成 合成新 1', exact: true })).toBeVisible();
    await app.evaluate(() => { (Reflect.get(globalThis, '__libraryConnect') as () => void)(); });
    await kg.getByRole('button', { name: '播放 酷狗合成 合成新 1', exact: true }).click();
    expect((await calls()).at(-1)).toMatchObject({ provider: 'kugou', operation: 'play', id: 'a'.repeat(32) });
    await kg.getByRole('checkbox', { name: '全选当前列表', exact: true }).check(); await kg.getByRole('button', { name: '下一首播放', exact: true }).click();
    await expect.poll(async () => (await calls()).filter(call => call.provider === 'kugou' && call.operation === 'next').length).toBe(2);
    expect((await calls()).filter(call => call.provider === 'kugou' && call.operation === 'next').map(call => call.id)).toEqual(['b'.repeat(32), 'a'.repeat(32)]);
    await input.fill('合成'); await input.press('Enter');
    await results.getByRole('button', { name: '播放 合成本地歌曲', exact: true }).click(); expect((await calls()).at(-1)).toMatchObject({ provider: 'local', operation: 'play', id: 'local-one' });
    await results.getByRole('button', { name: '歌单', exact: true }).click(); await expect(ne.getByRole('button', { name: /网易云合成公开歌单/ })).toBeVisible();
    await expect(results.getByRole('region', { name: '我的歌单搜索结果', exact: true }).getByRole('button')).toHaveCount(2);
    await ne.getByRole('button', { name: /网易云合成公开歌单/ }).click();
    await expect(page.getByRole('region', { name: '网易云音乐发现', exact: true }).getByRole('heading', { name: '合成公开歌单详情', exact: true })).toBeVisible();
    await page.getByRole('navigation', { name: '音乐库', exact: true }).getByRole('button', { name: '音乐库', exact: true }).click();
    await results.getByRole('region', { name: '我的歌单搜索结果', exact: true }).getByRole('button', { name: /kugou合成私人歌单/ }).click();
    await expect(page.getByRole('heading', { name: 'kugou合成私人歌单', level: 1, exact: true })).toBeVisible();
    await page.getByRole('navigation', { name: '音乐库', exact: true }).getByRole('button', { name: '音乐库', exact: true }).click(); await results.getByRole('button', { name: '歌曲', exact: true }).click();
    for (const theme of ['浅色', '暗色']) {
      await page.getByRole('button', { name: '账号与设置', exact: true }).click(); await page.getByRole('radio', { name: theme, exact: true }).check();
      await page.getByRole('navigation', { name: '音乐库', exact: true }).getByRole('button', { name: '音乐库', exact: true }).click();
      for (const width of [960, 1280]) {
        await page.setViewportSize({ width, height: 800 }); await input.focus();
        expect(await page.locator('main').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
        expect((await input.boundingBox())!.width).toBeGreaterThan(150);
        await page.screenshot({ path: `artifacts/library-search-${theme === '浅色' ? 'light' : 'dark'}-${width}.png`, animations: 'disabled' });
      }
    }
    await input.fill('空结果'); await input.press('Enter'); await expect(ne).toContainText('没有找到匹配歌曲'); await expect(kg).toContainText('没有找到匹配歌曲');
    await page.getByRole('button', { name: '清空全部来源搜索', exact: true }).click(); await expect(results).toHaveCount(0); await expect(input).toBeFocused();
    await expect(page.getByRole('heading', { name: '当前播放队列', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '打开本次播放队列，2 首音乐', exact: true }).click(); await expect(page.getByRole('dialog', { name: '播放队列 2', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await app.close(); await rm(profile, { recursive: true, force: true }); }
});
