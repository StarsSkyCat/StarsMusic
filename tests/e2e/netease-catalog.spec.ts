/// <reference lib="dom" />
import { _electron, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initialNeteaseSnapshot, neteaseChannels } from '../../packages/contracts/src/netease';
import type { CatalogRequest, NeteaseCatalog } from '../../packages/contracts/src/netease-catalog';

test('网易云发现、分类、双类型搜索、分页、详情和播放命令转发', async () => {
  const profile = await mkdtemp(path.join(tmpdir(), 'starsmusic-catalog-e2e-'));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL; env.GSETTINGS_BACKEND = 'memory';
  const desktop = await _electron.launch({ args: ['.', `--user-data-dir=${profile}`, '--password-store=basic'], env, chromiumSandbox: true, timeout: 10000 });
  try {
    const page = await desktop.firstWindow(); page.setDefaultTimeout(5000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByRole('heading', { name: '音乐库', exact: true })).toBeVisible();
    // 明确标识的合成 UI 数据及命令捕获：不调用平台、不认证、不模拟音频成功。
    const fixture = { ...initialNeteaseSnapshot(), revision: 100, generation: 50, status: 'connected' as const,
      membership: { status: 'ready' as const, benefits: [{ kind: 'vip' as const, expiresAt: Date.now() + 86400000 }], syncedAt: Date.now() },
      account: { id: '4242', nickname: '合成展示账号' }, playlists: [{ id: '900', name: '合成私人歌单', trackCount: 3 }],
      catalog: { ...initialNeteaseSnapshot().catalog, status: 'ready' as const, total: 32, more: true,
        tracks: Array.from({ length: 30 }, (_, index) => ({ id: String(index + 1), name: `合成热歌 ${index + 1}`, artists: ['合成歌手'], durationMs: 30000, rights: { fee: (index === 0 ? 'vip' : index === 1 ? 'album' : index === 2 ? 'vip-quality' : 'none') as 'vip' | 'album' | 'vip-quality' | 'none', playback: 'unknown' as const } })) } };
    await desktop.evaluate(({ ipcMain, BrowserWindow }, { channels, fixture }) => {
      let state = fixture;
      const calls: Record<string, unknown>[] = [];
      Reflect.set(globalThis, '__starsMusicCatalogCalls', calls);
      const publish = () => { BrowserWindow.getAllWindows()[0]!.webContents.send(channels.stateChanged, state); return state; };
      for (const channel of [channels.browse, channels.loadPlaylists, channels.loadPlaylist, channels.playTrack, channels.enqueueNext, channels.getArtwork, channels.refreshMembership, channels.playPlaylist]) ipcMain.removeHandler(channel);
      const artworkCalls: Record<string, unknown>[] = [];
      Reflect.set(globalThis, '__starsMusicArtworkCalls', artworkCalls);
      ipcMain.handle(channels.getArtwork, (_event, request: { kind: string; id: string; generation: number }) => {
        artworkCalls.push(request);
        if (request.id === '2' || request.id === '701') return null;
        if (request.id === '3' || request.id === '702') throw new Error('synthetic image failure');
        return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
      });
      ipcMain.handle(channels.refreshMembership, () => {
        calls.push({ operation: 'membership' });
        state = { ...state, revision: state.revision + 1, membership: { status: 'ready', benefits: [{ kind: 'vip', expiresAt: Date.now() + 86400000 }], syncedAt: Date.now() } };
        return publish();
      });
      ipcMain.handle(channels.playPlaylist, (_event, id: string) => { calls.push({ operation: 'playlist', id }); });
      ipcMain.handle(channels.loadPlaylists, () => publish());
      ipcMain.handle(channels.loadPlaylist, (_event, id: string) => {
        state = { ...state, revision: state.revision + 1, playlistId: id, tracks: [
          { id: '700', name: '合成私藏歌曲', artists: ['合成歌手'], durationMs: 30000, rights: { fee: 'album', playback: 'unavailable' } },
          { id: '701', name: '合成缺图歌曲', artists: ['合成歌手'], durationMs: 30000 },
          { id: '702', name: '合成图片请求失败歌曲', artists: ['合成歌手'], durationMs: 30000 },
        ] } as typeof state;
        return publish();
      });
      ipcMain.handle(channels.playTrack, (_event, id: string) => {
        calls.push({ operation: 'play', id });
        // 合成权限投影回归：不解析真实音频，也不改变播放器状态。
        state = { ...state, revision: state.revision + 1, catalog: { ...state.catalog, tracks: state.catalog.tracks.map(track => track.id === id ? { ...track, rights: { fee: 'vip', playback: 'preview' } } : track) } } as typeof state;
        publish();
      });
      ipcMain.handle(channels.enqueueNext, (_event, id: string) => { calls.push({ operation: 'next', id }); });
      ipcMain.handle(channels.browse, (_event, request: CatalogRequest) => {
        calls.push({ operation: 'browse', ...request });
        let catalog: NeteaseCatalog = { ...fixture.catalog, kind: request.kind, status: 'ready', offset: request.offset, tracks: [], playlists: [], more: false, total: 0 };
        if (request.kind === 'hot') catalog = { ...catalog, total: 32, more: request.offset === 0,
          tracks: Array.from({ length: request.offset ? 2 : 30 }, (_, index) => ({ id: String(request.offset + index + 1), name: `合成热歌 ${request.offset + index + 1}`, artists: ['合成歌手'], durationMs: 30000 })) };
        if (request.kind === 'playlists') catalog = { ...catalog, category: request.category, order: request.order, total: 1, playlists: [{ id: '901', name: `合成${request.category}歌单`, trackCount: 2 }] };
        if (request.kind === 'search') catalog = { ...catalog, query: request.query, searchType: request.searchType, total: request.query === '空结果' ? 0 : 1,
          ...(request.query === '空结果' ? {} : request.searchType === 'songs' ? { tracks: [{ id: '501', name: '合成搜索歌曲', artists: ['合成歌手'], durationMs: 30000 }] } : { playlists: [{ id: '902', name: '合成搜索歌单', trackCount: 2 }] }),
          ...(request.query === '失败' ? { status: 'error', tracks: [], playlists: [], error: { code: 'network', message: '网络连接失败', retryable: true } } : {}) };
        if (request.kind === 'playlist') catalog = { ...catalog, query: state.catalog.query, searchType: state.catalog.searchType,
          playlist: { id: request.id, name: '合成公开歌单详情', trackCount: 32 }, total: 32, more: request.offset === 0,
          tracks: Array.from({ length: request.offset ? 2 : 30 }, (_, i) => ({ id: String(601 + request.offset + i), name: i === 0 && request.offset === 0 ? '合成歌单歌曲' : `合成歌单歌曲 ${request.offset + i + 1}`, artists: ['合成歌手'], durationMs: 30000, rights: { fee: (i === 0 ? 'vip' : i === 1 ? 'album' : i === 2 ? 'vip-quality' : 'none') as 'vip' | 'album' | 'vip-quality' | 'none', playback: 'unknown' } })) };
        state = { ...state, revision: state.revision + 1, catalog } as typeof state;
        return publish();
      });
      publish();
    }, { channels: neteaseChannels, fixture });
    const calls = () => desktop.evaluate(() => Reflect.get(globalThis, '__starsMusicCatalogCalls') as Record<string, unknown>[]);
    await page.getByRole('navigation', { name: '音乐来源', exact: true }).getByRole('button', { name: /^网易云音乐/ }).click();
    const explore = page.getByRole('region', { name: '网易云音乐发现', exact: true });
    await expect(explore.getByRole('button', { name: '热歌榜', exact: true })).toHaveCount(0);
    await expect(explore.getByRole('button', { name: '合成展示账号', exact: true })).toBeVisible();
    await expect(explore.getByLabel('网易云官方会员权益')).toContainText('黑胶 VIP');
    await explore.getByRole('button', { name: '同步权益', exact: true }).click();
    expect((await calls()).at(-1)).toMatchObject({ operation: 'membership' });
    await expect(explore.getByRole('button', { name: /合成全部歌单/ })).toBeVisible();
    await expect(explore.locator('.ne-cover-card img')).toBeVisible();
    expect((await calls()).filter(call => call.kind).at(-1)).toMatchObject({ kind: 'playlists' });
    await expect(explore.getByRole('combobox')).toHaveCount(0);
    await explore.getByRole('button', { name: '华语', exact: true }).click();
    const sort = explore.getByRole('button', { name: '歌单排序', exact: true });
    await sort.click();
    const menu = page.getByRole('menu', { name: '歌单排序', exact: true });
    await expect(menu).toBeVisible();
    await page.getByRole('menuitemradio', { name: '最新', exact: true }).click();
    await expect(menu).not.toBeVisible();
    await sort.focus(); await sort.press('ArrowDown');
    await expect(page.getByRole('menuitemradio', { name: '最新', exact: true })).toBeFocused();
    await page.keyboard.press('Home');
    await expect(page.getByRole('menuitemradio', { name: '热门', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(sort).toBeFocused();
    await expect(explore.getByRole('button', { name: /合成华语歌单/ })).toBeVisible();
    expect((await calls()).at(-1)).toMatchObject({ kind: 'playlists', category: '华语', order: 'new', offset: 0 });
    await explore.getByRole('button', { name: /合成华语歌单/ }).click();
    await expect(explore.getByRole('heading', { name: '合成公开歌单详情', exact: true })).toBeVisible();
    for (const [index, fee] of ['VIP', '付费专辑', 'VIP 音质'].entries()) await expect(explore.locator('.song-list li').nth(index).locator('.track-fee')).toHaveText(fee);
    await expect(explore.locator('.song-list li').first().locator('img')).toBeVisible();
    const initialArtworkCalls = await desktop.evaluate(() => Reflect.get(globalThis, '__starsMusicArtworkCalls') as { id: string; generation: number }[]);
    expect(initialArtworkCalls.some(request => request.id === '630')).toBe(false);
    expect(initialArtworkCalls.every(request => request.generation === 50)).toBe(true);
    await explore.getByRole('button', { name: '下一页', exact: true }).click();
    await expect(explore.getByRole('button', { name: '播放 合成歌单歌曲 31', exact: true })).toBeVisible();
    await expect(explore.getByRole('button', { name: '下一页', exact: true })).toBeDisabled();
    await explore.getByRole('button', { name: '上一页', exact: true }).click();
    await explore.getByRole('button', { name: '从第一首听起', exact: true }).click();
    expect((await calls()).at(-1)).toMatchObject({ operation: 'playlist', id: '901' });
    await explore.getByRole('button', { name: '返回歌单发现', exact: true }).click();
    await explore.getByRole('button', { name: '搜索', exact: true }).click();
    await expect(explore.getByRole('heading', { name: '下一首喜欢的，搜搜看', exact: true })).toBeVisible();
    const search = page.getByRole('searchbox', { name: '搜索网易云歌曲或歌单', exact: true });
    await search.fill('合成关键词'); await search.press('Enter');
    await expect(explore.getByRole('button', { name: '播放 合成搜索歌曲', exact: true })).toBeVisible();
    await explore.locator('.song-list li').first().scrollIntoViewIfNeeded();
    await expect(explore.locator('.song-list img')).toBeVisible();
    await explore.getByRole('button', { name: '播放 合成搜索歌曲', exact: true }).click();
    expect((await calls()).at(-1)).toMatchObject({ operation: 'play', id: '501' });
    await expect(explore.locator('.song-list .track-access')).toHaveText('试听');
    await explore.getByRole('checkbox', { name: '选择 合成搜索歌曲', exact: true }).check();
    await explore.getByRole('button', { name: '下一首播放', exact: true }).click();
    await expect.poll(async () => (await calls()).at(-1)).toMatchObject({ operation: 'next', id: '501' });
    await page.screenshot({ path: 'artifacts/netease-synthetic-search.png', animations: 'disabled' });
    await explore.getByRole('button', { name: '歌单', exact: true }).click();
    await explore.getByRole('button', { name: /合成搜索歌单/ }).click();
    await expect(explore.getByRole('button', { name: '播放 合成歌单歌曲', exact: true })).toBeVisible();
    await explore.getByRole('button', { name: '返回搜索结果', exact: true }).click();
    await expect(search).toHaveValue('合成关键词');
    await explore.getByRole('button', { name: '歌曲', exact: true }).click();
    await search.fill('空结果'); await search.press('Enter');
    await expect(explore.getByRole('heading', { name: '没有找到匹配的内容', exact: true })).toBeVisible();
    await search.fill('失败'); await search.press('Enter');
    await expect(explore.getByRole('alert')).toContainText('网络连接失败');
    await explore.getByRole('button', { name: '发现歌单', exact: true }).click();
    await expect(explore.locator('.ne-cover-card')).toHaveCount(1);
    await explore.getByRole('button', { name: '我的歌单', exact: true }).click();
    await explore.getByRole('button', { name: /合成私人歌单/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: '合成私人歌单', exact: true })).toBeVisible();
    await expect(page.locator('.song-list .track-fee')).toHaveText('付费专辑');
    await expect(page.locator('.song-list li').nth(0).locator('.track-access')).toHaveText('暂不可用');
    await expect(page.locator('.song-list li')).toHaveCount(3);
    await expect(page.locator('.song-list li').nth(0).locator('.song-tile img')).toBeVisible();
    await page.locator('.song-list li').nth(2).scrollIntoViewIfNeeded();
    await expect(page.locator('.song-list .song-tile .artwork-missing')).toHaveCount(2);
    const ownedArtworkCalls = await desktop.evaluate(() => Reflect.get(globalThis, '__starsMusicArtworkCalls') as { id: string; kind: string; generation: number }[]);
    for (const id of ['700', '701', '702']) expect(ownedArtworkCalls).toContainEqual({ id, kind: 'track', generation: 50 });
    await page.screenshot({ path: 'artifacts/netease-synthetic-owned-tracks.png', animations: 'disabled' });
    await page.getByRole('button', { name: '返回全部歌单', exact: true }).click();
    await expect(explore.getByRole('button', { name: /合成私人歌单/ })).toBeVisible();
    await expect(explore.locator('.ne-cover-card img')).toBeVisible();
    await page.setViewportSize({ width: 960, height: 640 });
    expect(await page.locator('main').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: 'artifacts/netease-synthetic-owned-minimum.png', animations: 'disabled' });
    await page.getByRole('button', { name: '账号与设置', exact: true }).click();
    const dark = page.getByRole('radio', { name: '暗色', exact: true }); await dark.check(); await expect(dark).toBeEnabled();
    await page.getByRole('navigation', { name: '音乐来源', exact: true }).getByRole('button', { name: /^网易云音乐/ }).click();
    await explore.getByRole('button', { name: '搜索', exact: true }).click();
    await search.fill('合成关键词'); await search.press('Enter');
    await expect(explore.locator('.song-list li')).toHaveCount(1);
    for (const theme of ['浅色', '暗色']) {
      await page.getByRole('button', { name: '账号与设置', exact: true }).click(); await page.getByRole('radio', { name: theme, exact: true }).check();
      await page.getByRole('navigation', { name: '音乐来源', exact: true }).getByRole('button', { name: /^网易云音乐/ }).click();
      for (const width of [960, 1280]) {
        await page.setViewportSize({ width, height: 800 }); await search.focus();
        expect(await search.evaluate(node => getComputedStyle(node).outlineStyle)).toBe('none');
        expect(await page.locator('main').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
        expect((await search.boundingBox())!.width).toBeGreaterThan(200);
        await page.screenshot({ path: `artifacts/netease-search-refined-${theme === '浅色' ? 'light' : 'dark'}-${width}.png`, animations: 'disabled' });
      }
    }
    await explore.getByRole('button', { name: '清空关键词', exact: true }).click();
    await expect(search).toHaveValue(''); await expect(search).toBeFocused(); await expect(explore.getByRole('button', { name: '搜索网易云', exact: true })).toBeDisabled();
    expect((await calls()).some(call => call.kind === 'hot')).toBe(false);
    expect(errors).toEqual([]);
  } finally { await desktop.close(); await rm(profile, { recursive: true, force: true }); }
});
