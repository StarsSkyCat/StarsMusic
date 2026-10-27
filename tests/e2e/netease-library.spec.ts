/// <reference lib="dom" />
import { _electron, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { initialNeteaseSnapshot, neteaseChannels, type NeteaseSnapshot } from '../../packages/contracts/src/netease';
import type { DesktopApi } from '../../packages/contracts/src/desktop';
import type { NeteaseMutation } from '../../packages/contracts/src/netease-library';
import type { CatalogRequest } from '../../packages/contracts/src/netease-catalog';

test('合成收藏流程：喜欢切换、自建歌单添加/移除、喜欢列表移除与发现歌单收藏', async () => {
  const profile = await mkdtemp('/tmp/starsmusic-library-e2e-');
  const env: Record<string, string> = {}; for (const [key,value] of Object.entries(process.env)) if (value !== undefined) env[key] = value; env.GSETTINGS_BACKEND = 'memory'; delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
  const app = await _electron.launch({ args: ['.', `--user-data-dir=${profile}`, '--password-store=basic'], env, chromiumSandbox: true });
  try {
    const page = await app.firstWindow(); page.setDefaultTimeout(5000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.getByRole('heading', { name: '音乐库', exact: true })).toBeVisible();
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    // 仅在测试主进程注入明确标识的合成数据与写命令捕获，不认证、不触碰真实账号。
    const tracks = [7,8].map(id => ({ id: String(id), name: `合成歌曲 ${id}`, artists: ['合成歌手'], durationMs: 30000 }));
    const fixture: NeteaseSnapshot = { ...initialNeteaseSnapshot(), revision: 100, generation: 50, status: 'connected', account: { id: '42', nickname: '合成收藏账号' },
      playlists: [{ id: '11', name: '合成自建歌单', trackCount: 2, editable: true, likedSongs: false, subscribed: false }, { id: '12', name: '合成喜欢歌单', trackCount: 1, editable: true, likedSongs: true, subscribed: false }],
      library: { likedIds: [], likesStatus: 'ready', busy: false }, catalog: { ...initialNeteaseSnapshot().catalog, status: 'ready', total: 2, tracks } };
    await app.evaluate(({ ipcMain, BrowserWindow }, { channels, fixture, tracks }) => {
      let state = fixture; const calls: unknown[] = []; Reflect.set(globalThis, '__libraryCalls', calls);
      const publish = () => { state = { ...state, revision: state.revision + 1 }; BrowserWindow.getAllWindows()[0]!.webContents.send(channels.stateChanged, state); return state; };
      for (const channel of [channels.getArtwork, channels.loadPlaylists, channels.loadLikes, channels.refreshLibrary, channels.loadPlaylist, channels.browse, channels.updateLibrary]) ipcMain.removeHandler(channel);
      ipcMain.handle(channels.getArtwork, () => null);
      ipcMain.handle(channels.loadPlaylists, publish); ipcMain.handle(channels.loadLikes, publish); ipcMain.handle(channels.refreshLibrary, publish);
      ipcMain.handle(channels.loadPlaylist, (_event, id: string) => { state = { ...state, playlistId: id, tracks: id === '12' ? tracks.filter(track => state.library.likedIds.includes(track.id)) : tracks }; return publish(); });
      ipcMain.handle(channels.browse, (_event, request: CatalogRequest) => {
        state = { ...state, catalog: { ...state.catalog, kind: request.kind, status: 'ready', offset: 0, more: false, total: 2, tracks: request.kind === 'playlists' ? [] : tracks, playlists: request.kind === 'playlists' ? [{ id: '90', name: '合成发现歌单', trackCount: 2 }] : [], ...(request.kind === 'playlist' ? { playlist: { id: '90', name: '合成发现歌单', trackCount: 2 } } : { playlist: undefined }) } } as typeof state;
        return publish();
      });
      ipcMain.handle(channels.updateLibrary, (_event, mutation: NeteaseMutation) => {
        calls.push(mutation);
        if (mutation.kind === 'like') state = { ...state, library: { ...state.library, likedIds: mutation.liked ? [...new Set([...state.library.likedIds, mutation.id])] : state.library.likedIds.filter(id => id !== mutation.id) } };
        if (mutation.kind === 'playlist-track' && mutation.operation === 'del') state = { ...state, tracks: state.tracks.filter(track => track.id !== mutation.trackId), library: mutation.playlistId === '12' ? { ...state.library, likedIds: state.library.likedIds.filter(id => id !== mutation.trackId) } : state.library };
        if (mutation.kind === 'subscribe') state = { ...state, playlists: mutation.subscribed ? [...state.playlists, { id: '90', name: '合成发现歌单', trackCount: 2, editable: false, subscribed: true }] : state.playlists.filter(item => item.id !== '90') };
        return publish();
      });
      publish();
    }, { channels: neteaseChannels, fixture, tracks });
    const calls = () => app.evaluate(() => Reflect.get(globalThis, '__libraryCalls') as NeteaseMutation[]);
    await page.getByRole('navigation', { name: '音乐来源', exact: true }).getByRole('button', { name: /^网易云音乐/ }).click();
    const explore = page.getByRole('region', { name: '网易云音乐发现', exact: true });
    await explore.getByRole('button', { name: '搜索', exact: true }).click();
    await explore.getByRole('searchbox').fill('合成'); await explore.getByRole('searchbox').press('Enter');
    const more = () => page.getByRole('button', { name: '更多操作 合成歌曲 7', exact: true });
    await more().click(); await page.getByRole('menuitem', { name: '添加喜欢', exact: true }).click();
    expect((await calls()).at(-1)).toMatchObject({ kind: 'like', id: '7', liked: true });
    await more().click(); await page.getByRole('menuitem', { name: '取消喜欢', exact: true }).click();
    expect((await calls()).at(-1)).toMatchObject({ kind: 'like', id: '7', liked: false });
    await more().click(); await page.getByRole('menuitem', { name: '添加喜欢', exact: true }).click();
    await more().click(); await page.getByRole('menuitem', { name: '添加到歌单', exact: true }).click();
    const picker = page.getByRole('dialog', { name: '添加到自建歌单', exact: true });
    await expect(picker).toBeVisible(); await expect(picker.getByRole('button', { name: /合成喜欢歌单/ })).toHaveCount(0);
    await page.screenshot({ path: 'artifacts/netease-library-synthetic-picker.png', animations: 'disabled' });
    await picker.getByRole('button', { name: /合成自建歌单/ }).click(); await expect(picker).not.toBeVisible();
    expect((await calls()).at(-1)).toMatchObject({ kind: 'playlist-track', playlistId: '11', trackId: '7', operation: 'add' });
    await explore.getByRole('button', { name: '我的歌单', exact: true }).click();
    await explore.getByRole('button', { name: /合成自建歌单/ }).click();
    await more().click(); await page.getByRole('menuitem', { name: '从歌单移除', exact: true }).click();
    await expect(page.locator('.song-list li')).toHaveCount(1);
    expect((await calls()).at(-1)).toMatchObject({ kind: 'playlist-track', playlistId: '11', trackId: '7', operation: 'del' });
    await page.getByRole('button', { name: '返回全部歌单', exact: true }).click();
    await explore.getByRole('button', { name: /合成喜欢歌单/ }).click();
    await more().click(); await page.getByRole('menuitem', { name: '从歌单移除', exact: true }).click();
    await expect(page.locator('.song-list li')).toHaveCount(0);
    expect((await calls()).at(-1)).toMatchObject({ kind: 'playlist-track', playlistId: '12', operation: 'del' });
    await page.getByRole('button', { name: '返回全部歌单', exact: true }).click();
    await explore.getByRole('button', { name: '发现歌单', exact: true }).click();
    await explore.getByRole('button', { name: /合成发现歌单/ }).click();
    await explore.getByRole('button', { name: '收藏歌单', exact: true }).click();
    await expect(explore.getByRole('button', { name: '取消收藏歌单', exact: true })).toBeVisible();
    expect((await calls()).at(-1)).toMatchObject({ kind: 'subscribe', id: '90', subscribed: true });
    await explore.getByRole('button', { name: '我的歌单', exact: true }).click();
    await explore.getByRole('button', { name: /合成发现歌单/ }).click();
    await more().click(); await expect(page.getByRole('menuitem', { name: '从歌单移除', exact: true })).toHaveCount(0); await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '账号与设置', exact: true }).click(); await page.getByRole('radio', { name: '暗色', exact: true }).check();
    await page.getByRole('navigation', { name: '音乐来源', exact: true }).getByRole('button', { name: /^网易云音乐/ }).click();
    await explore.getByRole('button', { name: '搜索', exact: true }).click();
    await explore.getByRole('searchbox').fill('合成'); await explore.getByRole('searchbox').press('Enter');
    await page.setViewportSize({ width: 960, height: 640 }); await more().click();
    await expect(page.getByRole('menu', { name: '合成歌曲 7的操作', exact: true })).toBeVisible();
    expect(await page.locator('main').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: 'artifacts/netease-library-synthetic-dark-actions.png', animations: 'disabled' });
    expect(errors).toEqual([]);
    expect(await page.evaluate(async () => (await (window as unknown as { starsMusic: DesktopApi }).starsMusic.playback.getState()).status)).toBe('idle');
  } finally { await app.close(); await rm(profile, { recursive: true, force: true }); }
});
