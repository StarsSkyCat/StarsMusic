/// <reference lib="dom" />
import { _electron, expect, test } from '@playwright/test';
import { mkdtemp, readFile, readlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeSilentWav } from '../helpers/audio';
import type { PlaybackApi } from '../../packages/contracts/src/playback';

test('真实应用重启保留队列顺序/当前项/进度/音量/静音，暂停启动，继续使用系统音频输出', async () => {
  const profile = await mkdtemp(path.join(tmpdir(), 'starsmusic-session-e2e-'));
  const files = ['first.wav', 'second.wav', 'third.wav'].map(file => path.join(profile, file));
  await Promise.all(files.map(file => writeSilentWav(file)));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL; env.GSETTINGS_BACKEND = 'memory';
  const launch = () => _electron.launch({ args: ['.', `--user-data-dir=${profile}`, '--password-store=basic'], env, chromiumSandbox: true });
  let desktop: Awaited<ReturnType<typeof launch>> | undefined;
  const mpvChildren = async (): Promise<number[]> => {
    const pid = desktop!.process().pid!;
    const ids = (await readFile(`/proc/${pid}/task/${pid}/children`, 'utf8')).trim().split(/\s+/).filter(Boolean);
    const result: number[] = [];
    for (const id of ids) { try { if ((await readlink(`/proc/${id}/exe`)).endsWith('/mpv')) result.push(Number(id)); } catch { /* 已退出 */ } }
    return result;
  };
  try {
    desktop = await launch(); let page = await desktop.firstWindow();
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByRole('heading', { name: '音乐库', exact: true })).toBeVisible();
    const state = () => page.evaluate(async () => (window as unknown as { starsMusic: { playback: PlaybackApi } }).starsMusic.playback.getState());
    await desktop.evaluate(({ dialog }, files) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files }); }, files);
    await page.getByRole('button', { name: '选择本地音频', exact: true }).click();
    await expect.poll(async () => (await state()).status).toBe('playing');
    await page.evaluate(async () => {
      const api = (window as unknown as { starsMusic: { playback: PlaybackApi } }).starsMusic.playback;
      const queue = (await api.getState()).queue; await api.moveNext(queue[2]!.id); await api.playTrack(queue[1]!.id);
    });
    await expect.poll(async () => (await state()).status).toBe('playing');
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    await expect.poll(async () => (await state()).status).toBe('paused');
    await page.getByRole('slider', { name: '播放进度' }).fill('9');
    await expect.poll(async () => (await state()).positionSeconds).toBeGreaterThanOrEqual(8.7);
    await page.getByRole('slider', { name: '音量', exact: true }).fill('46');
    await expect.poll(async () => (await state()).volume).toBe(46);
    await page.getByRole('button', { name: '静音', exact: true }).click();
    await expect.poll(async () => (await state()).muted).toBe(true);
    const before = await state(); expect(before.currentIndex).toBe(2);
    expect(before.queue.map(track => track.title)).toEqual(['first.wav', 'third.wav', 'second.wav']);
    expect(JSON.stringify(before)).not.toContain(profile);
    // 即时退出，验证关闭时冲刷，不能只依赖后台定时写盘。
    await desktop.close(); desktop = undefined;
    desktop = await launch(); page = await desktop.firstWindow();
    await expect(page.getByRole('heading', { name: '音乐库', exact: true })).toBeVisible();
    const after = await state(); expect(after.queue).toEqual(before.queue); expect(after.currentIndex).toBe(2);
    expect(after.positionSeconds).toBeCloseTo(before.positionSeconds, 1); expect(after.durationSeconds).toBe(before.durationSeconds);
    expect(after.volume).toBe(46); expect(after.muted).toBe(true); expect(after.status).toBe('paused'); expect(after.saveError).toBeUndefined();
    expect(after.engineVersion).toBeUndefined(); expect(await mpvChildren()).toEqual([]);
    await expect(page.getByRole('button', { name: '取消静音', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '播放', exact: true }).click();
    await expect.poll(async () => (await state()).status).toBe('playing');
    await expect.poll(async () => (await state()).positionSeconds).toBeGreaterThanOrEqual(8.7);
    const output = (await state()).audioOutput; expect(output).toBeTruthy(); expect(output).not.toBe('null');
    expect(await mpvChildren()).toHaveLength(1);
    await page.getByRole('button', { name: '取消静音', exact: true }).click();
    await expect.poll(async () => (await state()).muted).toBe(false); expect((await state()).volume).toBe(46);
    await page.evaluate(async () => {
      const api = (window as unknown as { starsMusic: { playback: PlaybackApi } }).starsMusic.playback;
      const queue = (await api.getState()).queue; await api.removeTrack(queue[0]!.id); await api.pause();
    });
    await expect.poll(async () => (await state()).status).toBe('paused');
    await desktop.close(); desktop = undefined;
    desktop = await launch(); page = await desktop.firstWindow();
    await expect(page.getByRole('heading', { name: '音乐库', exact: true })).toBeVisible();
    expect((await state()).queue.map(track => track.title)).toEqual(['third.wav', 'second.wav']);
    expect((await state()).currentIndex).toBe(1); expect((await state()).muted).toBe(false); expect(await mpvChildren()).toEqual([]);
  } finally { await desktop?.close(); await rm(profile, { recursive: true, force: true }); }
});

test('合成在线保存项重启后等待原账号，匿名后台状态不清队列，显式退出只删除对应平台并持久化', async () => {
  const profile = await mkdtemp(path.join(tmpdir(), 'starsmusic-parked-e2e-'));
  const { SqlitePlaybackSessionStore } = await import('../../packages/storage/src/playback-session-store');
  const store = new SqlitePlaybackSessionStore(path.join(profile, 'playback.sqlite'));
  await store.write({ version: 1, queue: [
    { id: 'ne-synthetic', kind: 'netease', sourceId: '7', accountId: '42', title: '合成网易云项' },
    { id: 'kg-synthetic', kind: 'kugou', sourceId: 'a'.repeat(32), accountId: '42', title: '合成酷狗项' },
  ], currentId: 'ne-synthetic', positionSeconds: 12, durationSeconds: 30, volume: 50, muted: false, lastAudibleVolume: 50 });
  await store.close();
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL; env.GSETTINGS_BACKEND = 'memory';
  const launch = () => _electron.launch({ args: ['.', `--user-data-dir=${profile}`, '--password-store=basic'], env, chromiumSandbox: true });
  let desktop: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    desktop = await launch(); let page = await desktop.firstWindow();
    await expect(page.getByRole('heading', { name: '音乐库', exact: true })).toBeVisible();
    const state = await page.evaluate(async () => {
      const api = (window as unknown as { starsMusic: { playback: PlaybackApi; netease: { getState(): Promise<unknown>; logout(): Promise<unknown> }; kugou: { getState(): Promise<unknown> } } }).starsMusic;
      await Promise.all([api.netease.getState(), api.kugou.getState()]);
      const parked = await api.playback.getState(); const tried = await api.playback.resume(); await api.netease.logout();
      return { parked, tried, cleared: await api.playback.getState() };
    });
    expect(state.parked.queue).toHaveLength(2); expect(state.parked.status).toBe('paused');
    expect(state.tried.error?.code).toBe('playback-login-required'); expect(state.tried.positionSeconds).toBe(12);
    expect(state.cleared.queue.map(track => track.provider)).toEqual(['kugou']);
    await desktop.close(); desktop = undefined;
    desktop = await launch(); page = await desktop.firstWindow();
    await expect(page.getByRole('heading', { name: '音乐库', exact: true })).toBeVisible();
    const after = await page.evaluate(async () => (window as unknown as { starsMusic: { playback: PlaybackApi } }).starsMusic.playback.getState());
    expect(after.queue.map(track => track.provider)).toEqual(['kugou']); expect(after.currentIndex).toBeNull();
  } finally { await desktop?.close(); await rm(profile, { recursive: true, force: true }); }
});
