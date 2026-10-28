/// <reference lib="dom" />
import { _electron, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { initialKugouSnapshot, kugouChannels, type KugouSnapshot } from '../../packages/contracts/src/kugou';
import { initialKugouCatalog, type KugouCatalogRequest } from '../../packages/contracts/src/kugou-catalog';

test('合成酷狗发现/双类型搜索/分页/私人歌单封面/整单与多选命令，双主题最小窗口', async () => {
  const profile = await mkdtemp(path.join(tmpdir(), 'starsmusic-kugou-catalog-e2e-'));
  const env: Record<string, string> = {}; for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL; env.GSETTINGS_BACKEND = 'memory';
  const app = await _electron.launch({ args: ['.', `--user-data-dir=${profile}`, '--password-store=basic'], env, chromiumSandbox: true });
  try {
    const page = await app.firstWindow(); page.setDefaultTimeout(5000); await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.getByRole('heading', { name: '音乐库', exact: true })).toBeVisible();
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    // 明确的合成 UI 投影与命令捕获：不认证、不请求平台、不模拟音频成功。
    await app.evaluate(({ ipcMain, BrowserWindow }, { channels, initial, catalog }) => {
      let state: KugouSnapshot = { ...initial, revision: 100, generation: 50 };
      const calls: Record<string, unknown>[] = []; Reflect.set(globalThis, '__kugouCatalogCalls', calls);
      const tracks = ['a', 'b', 'c'].map((letter, i) => ({ id: letter.repeat(32), name: `合成酷狗歌曲 ${i + 1}`, artists: ['合成歌手'], durationMs: 30000, rights: { fee: (i === 0 ? 'vip' : i === 1 ? 'vip-quality' : 'unknown') as 'vip' | 'vip-quality' | 'unknown', playback: 'unknown' as const } }));
      const playlists = [{ id: 'collection_1_synthetic', name: '合成发现歌单', trackCount: 31 }, { id: 'collection_2_synthetic', name: '合成未知数量歌单' }];
      const publish = () => { state = { ...state, revision: state.revision + 1 }; BrowserWindow.getAllWindows()[0]!.webContents.send(channels.stateChanged, state); return state; };
      for (const key of [channels.browse, channels.getArtwork, channels.loadPlaylists, channels.loadPlaylist, channels.playPlaylist, channels.playTrack, channels.enqueueNext, channels.refreshMembership]) ipcMain.removeHandler(key);
      ipcMain.handle(channels.getArtwork, (_event, request: { id: string; kind: string; generation: number }) => {
        calls.push({ operation: 'artwork', ...request }); if (request.id === 'b'.repeat(32)) return null;
        if (request.id === 'c'.repeat(32)) throw new Error('synthetic unavailable');
        return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
      });
      ipcMain.handle(channels.browse, (_event, request: KugouCatalogRequest) => {
        calls.push({ operation: 'browse', ...request });
        state = { ...state, catalog: { ...catalog, query: request.kind === 'search' ? request.query : state.catalog.query, searchType: request.kind === 'search' ? request.searchType : state.catalog.searchType, kind: request.kind, status: 'ready', offset: request.offset,
          ...(request.kind === 'playlists' ? { playlists: request.offset ? [playlists[0]!] : playlists, more: request.offset === 0 } : {}),
          ...(request.kind === 'search' ? { total: request.query === '空结果' ? 0 : 31,
            ...(request.query === '空结果' ? {} : request.searchType === 'songs' ? { tracks: request.offset ? [tracks[0]!] : tracks, more: request.offset === 0 } : { playlists: [playlists[0]!] }),
            ...(request.query === '失败' ? { status: 'error', tracks: [], error: { code: 'network', message: '网络连接失败', retryable: true } } : {}) } : {}),
          ...(request.kind === 'playlist' ? { playlist: { id: request.id, name: '合成公开歌单详情', trackCount: 3 }, tracks, total: 3 } : {}),
        } }; return publish();
      });
      ipcMain.handle(channels.refreshMembership, () => { calls.push({ operation: 'membership' }); return publish(); });
      Reflect.set(globalThis, '__kugouMembershipFailure', () => { state = { ...state, membership: { status: 'error', benefits: [{ kind: 'standard' }], error: { code: 'network', message: '网络连接失败', retryable: true } } }; publish(); });
      ipcMain.handle(channels.loadPlaylists, publish);
      ipcMain.handle(channels.loadPlaylist, (_event, id: string) => { state = { ...state, playlistId: id, tracks }; return publish(); });
      ipcMain.handle(channels.playTrack, (_event, id: string) => { calls.push({ operation: 'play', id }); });
      ipcMain.handle(channels.enqueueNext, (_event, id: string) => { calls.push({ operation: 'next', id }); });
      ipcMain.handle(channels.playPlaylist, (_event, id: string, source: string) => { calls.push({ operation: 'playlist', id, source }); });
      Reflect.set(globalThis, '__connectSyntheticKugou', () => {
        state = { ...state, generation: 51, status: 'connected', account: { id: '42', nickname: '合成酷狗账号' }, membership: { status: 'ready', benefits: [{ kind: 'standard' }, { kind: 'svip', expiresAt: Date.now() + 86400000 }, { kind: 'tvip', expiresAt: Date.now() + 3600000 }, { kind: 'qvip', expiresAt: Date.now() - 1000 }, { kind: 'dvip', startsAt: Date.now() + 3600000 }], syncedAt: Date.now() }, playlists: [{ id: '11', name: '合成私人酷狗歌单', trackCount: 3 }] }; publish();
      });
      publish();
    }, { channels: kugouChannels, initial: initialKugouSnapshot(), catalog: initialKugouCatalog() });
    const calls = () => app.evaluate(() => Reflect.get(globalThis, '__kugouCatalogCalls') as Record<string, unknown>[]);
    await page.getByRole('navigation', { name: '音乐来源', exact: true }).getByRole('button', { name: /^酷狗音乐/ }).click();
    const explore = page.getByRole('region', { name: '酷狗音乐发现', exact: true });
    await expect(explore.locator('.ne-cover-card')).toHaveCount(2); await expect(explore.locator('.ne-cover-card img').first()).toBeVisible();
    await expect(explore.getByRole('button', { name: /合成未知数量歌单/ })).toContainText('查看歌单');
    await explore.getByRole('button', { name: '下一页', exact: true }).click(); await expect(explore.getByRole('button', { name: '下一页', exact: true })).toBeDisabled();
    expect((await calls()).filter(call => call.operation === 'browse').at(-1)).toMatchObject({ kind: 'playlists', offset: 30 });
    await explore.getByRole('navigation', { name: '酷狗内容导航' }).getByRole('button', { name: '搜索', exact: true }).click();
    const input = page.getByRole('searchbox', { name: '搜索酷狗歌曲或歌单', exact: true });
    await input.fill('合成'); await input.press('Enter'); await expect(explore.locator('.song-list li')).toHaveCount(3);
    await expect(explore.locator('.song-list li').nth(0).locator('.track-fee')).toHaveText('VIP');
    await expect(explore.locator('.song-list li').nth(1).locator('.track-fee')).toHaveText('VIP 音质');
    await expect(explore.locator('.song-list img')).toBeVisible(); await explore.locator('.song-list li').nth(2).scrollIntoViewIfNeeded();
    await expect(explore.locator('.song-list .artwork-missing')).toHaveCount(2);
    await explore.getByRole('button', { name: '播放 合成酷狗歌曲 1', exact: true }).click();
    await expect(explore.getByRole('alert')).toContainText('先连接标准版酷狗'); expect((await calls()).some(call => call.operation === 'play')).toBe(false);
    await explore.getByRole('button', { name: '下一页', exact: true }).click(); await expect(explore.locator('.song-list li')).toHaveCount(1);
    await explore.getByRole('button', { name: '上一页', exact: true }).click();
    await explore.getByRole('button', { name: '歌单', exact: true }).click(); await explore.getByRole('button', { name: /合成发现歌单/ }).click();
    await expect(explore.getByRole('heading', { name: '合成公开歌单详情', exact: true })).toBeVisible();
    await explore.getByRole('button', { name: '返回搜索结果', exact: true }).click(); await expect(input).toHaveValue('合成');
    await app.evaluate(() => { (Reflect.get(globalThis, '__connectSyntheticKugou') as () => void)(); });
    await expect(explore.getByRole('button', { name: '合成酷狗账号', exact: true })).toBeVisible();
    const membership = page.locator('#provider-account').getByRole('region', { name: '酷狗官方会员权益', exact: true });
    await expect(membership).toContainText('标准版 VIP'); await expect(membership).toContainText('概念版 VIP'); await expect(membership).toContainText('畅听 VIP');
    await page.locator('#provider-account').scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'artifacts/kugou-synthetic-account-header.png', animations: 'disabled' });
    await expect(membership).not.toContainText('QVIP'); await expect(membership).not.toContainText('DVIP');
    await membership.getByRole('button', { name: '同步权益', exact: true }).click(); expect((await calls()).at(-1)).toMatchObject({ operation: 'membership' });
    await explore.getByRole('button', { name: '歌曲', exact: true }).click(); await expect(explore.locator('.song-list li')).toHaveCount(3);
    await explore.getByRole('button', { name: '播放 合成酷狗歌曲 1', exact: true }).click();
    expect((await calls()).filter(call => call.operation === 'play').at(-1)).toMatchObject({ operation: 'play', id: 'a'.repeat(32) });
    await explore.getByRole('checkbox', { name: '选择 合成酷狗歌曲 1', exact: true }).check();
    await explore.getByRole('checkbox', { name: '选择 合成酷狗歌曲 2', exact: true }).check();
    const before = (await calls()).filter(call => call.operation === 'next').length;
    await explore.getByRole('button', { name: '下一首播放', exact: true }).click();
    await expect.poll(async () => (await calls()).filter(call => call.operation === 'next').length).toBe(before + 2);
    expect((await calls()).filter(call => call.operation === 'next').slice(-2).map(call => call.id)).toEqual(['b'.repeat(32), 'a'.repeat(32)]);
    await explore.getByRole('button', { name: '歌单', exact: true }).click(); await explore.getByRole('button', { name: /合成发现歌单/ }).click();
    await explore.getByRole('button', { name: '播放全部', exact: true }).click(); expect((await calls()).filter(call => call.operation === 'playlist').at(-1)).toMatchObject({ source: 'public', id: 'collection_1_synthetic' });
    await explore.getByRole('button', { name: '我的歌单', exact: true }).click(); await explore.getByRole('button', { name: /合成私人酷狗歌单/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: '合成私人酷狗歌单', exact: true })).toBeVisible();
    await expect(page.locator('.song-list img')).toBeVisible();
    await expect(page.locator('.song-list li').first().locator('.track-fee')).toHaveText('VIP');
    await page.getByRole('button', { name: '播放全部', exact: true }).click(); expect((await calls()).filter(call => call.operation === 'playlist').at(-1)).toMatchObject({ source: 'owned', id: '11' });
    await page.screenshot({ path: 'artifacts/kugou-synthetic-owned-tracks.png', animations: 'disabled' });
    await page.getByRole('button', { name: '返回全部歌单', exact: true }).click(); await expect(explore.getByRole('button', { name: /合成私人酷狗歌单/ })).toBeVisible();
    for (const theme of ['浅色', '暗色']) {
      await page.getByRole('button', { name: '设置', exact: true }).click(); await page.getByRole('radio', { name: theme, exact: true }).check();
      await page.getByRole('navigation', { name: '音乐来源', exact: true }).getByRole('button', { name: /^酷狗音乐/ }).click();
      await explore.getByRole('navigation', { name: '酷狗内容导航' }).getByRole('button', { name: '搜索', exact: true }).click(); await explore.getByRole('button', { name: '歌曲', exact: true }).click();
      for (const width of [960, 1280]) {
        await page.setViewportSize({ width, height: 800 }); await expect(explore.locator('.song-list li')).toHaveCount(3);
        expect(await page.locator('main').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
        expect((await input.boundingBox())!.width).toBeGreaterThan(200);
        await input.focus(); expect(await input.evaluate(node => getComputedStyle(node).outlineStyle)).toBe('none');
        await page.screenshot({ path: `artifacts/kugou-synthetic-${theme === '浅色' ? 'light' : 'dark'}-${width}.png`, animations: 'disabled' });
      }
    }
    await explore.getByRole('button', { name: '清空关键词', exact: true }).click(); await expect(input).toHaveValue(''); await expect(input).toBeFocused();
    await expect(explore.getByRole('button', { name: '搜索酷狗', exact: true })).toBeDisabled();
    await app.evaluate(() => { (Reflect.get(globalThis, '__kugouMembershipFailure') as () => void)(); });
    await expect(membership).toContainText('部分权益未同步'); await expect(membership).toContainText('标准版 VIP');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.getByRole('region', { name: '酷狗官方会员权益', exact: true })).toHaveCount(0);
    await page.getByRole('navigation', { name: '音乐来源', exact: true }).getByRole('button', { name: /^酷狗音乐/ }).click();
    await input.fill('空结果'); await input.press('Enter'); await expect(explore.getByRole('heading', { name: '没有找到匹配的内容', exact: true })).toBeVisible();
    await input.fill('失败'); await input.press('Enter'); await expect(explore.getByRole('alert')).toContainText('网络连接失败');
    expect(errors).toEqual([]);
  } finally { await app.close(); await rm(profile, { recursive: true, force: true }); }
});
