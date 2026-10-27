import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { parseStoredPlaybackSession, type StoredPlaybackSession } from '../../packages/contracts/src/playback-session.ts';
import { SqlitePlaybackSessionStore, type PlaybackSessionStore } from '../../packages/storage/src/playback-session-store.ts';
import { MusicPlayer } from '../../packages/playback/src/player.ts';
import { PlaybackSession } from '../../src/main/playback-session.ts';
import { DomainError } from '../../packages/contracts/src/errors.ts';

const saved = (): StoredPlaybackSession => ({ version: 1, queue: [
  { id: 'local-1', kind: 'local', path: '/tmp/synthetic-missing.wav', title: '本地合成项' },
  { id: 'online-1', kind: 'netease', sourceId: '7', accountId: '42', title: '云端合成项' },
  { id: 'online-2', kind: 'kugou', sourceId: 'a'.repeat(32), accountId: '84', title: '酷狗合成项' },
], currentId: 'online-1', positionSeconds: 12, durationSeconds: 30, volume: 63, muted: true, lastAudibleVolume: 63 });
const neverResolve = async (): Promise<never> => { throw new Error('synthetic unavailable'); };

test('播放保存契约严格白名单，拒绝流地址/凭据/相对路径/重复 ID 和未知版本', () => {
  assert.deepEqual(parseStoredPlaybackSession(saved()), saved());
  for (const value of [
    { ...saved(), version: 2 }, { ...saved(), token: 'synthetic-secret' }, { ...saved(), currentId: 'missing' },
    { ...saved(), queue: [saved().queue[0], saved().queue[0]] },
    { ...saved(), queue: [{ ...saved().queue[0], path: 'relative.wav' }] },
    { ...saved(), queue: [{ ...saved().queue[0], path: '/tmp/secret.txt' }] },
    { ...saved(), queue: [{ ...saved().queue[1], url: 'https://synthetic.invalid/signed' }] },
    { ...saved(), queue: [{ ...saved().queue[1], accountId: '' }] },
    { ...saved(), volume: 101 }, { ...saved(), muted: 'yes' }, { ...saved(), lastAudibleVolume: 0 },
  ]) assert.throws(() => parseStoredPlaybackSession(value));
});

test('播放模式和随机原序跨 SQLite 实例恢复，旧记录默认顺序播放，拒绝损坏原序', async () => {
  const directory = await mkdtemp('/tmp/starsmusic-mode-db-'); const file = path.join(directory, 'playback.sqlite');
  let store = new SqlitePlaybackSessionStore(file); const first = new MusicPlayer(); const second = new MusicPlayer();
  try {
    first.restoreSession(saved(), neverResolve); assert.equal(first.snapshot().loopMode, 'none'); assert.equal(first.snapshot().shuffle, false);
    first.setLoopMode('track'); first.setShuffle(true); const session = first.exportSession();
    await store.write(session); await store.close(); store = new SqlitePlaybackSessionStore(file);
    const read = (await store.read())!; assert.deepEqual(read, session); second.restoreSession(read, neverResolve);
    assert.equal(second.snapshot().loopMode, 'track'); assert.equal(second.snapshot().shuffle, true);
    second.setShuffle(false); assert.deepEqual(second.snapshot().queue.map(track => track.id), saved().queue.map(track => track.id));
    for (const invalid of [{ ...session, loopMode: 'invalid' }, { ...session, shuffle: 1 }, { ...session, originalOrder: [] }, { ...session, originalOrder: session.queue.map(() => session.queue[0]!.id) }]) assert.throws(() => parseStoredPlaybackSession(invalid));
  } finally { await store.close(); await first.dispose(); await second.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test('SQLite 跨实例恢复队列顺序、进度与静音，事务失败保留此前记录及私有文件权限', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'starsmusic-playback-db-')); const file = path.join(directory, 'playback.sqlite');
  let store = new SqlitePlaybackSessionStore(file);
  try {
    assert.equal(await store.read(), undefined); await store.write(saved()); await store.close();
    store = new SqlitePlaybackSessionStore(file); assert.deepEqual(await store.read(), saved());
    if (process.platform !== 'win32') { assert.equal((await stat(file)).mode & 0o777, 0o600); assert.equal((await stat(directory)).mode & 0o777, 0o700); }
    const db = new DatabaseSync(file);
    db.exec("CREATE TRIGGER synthetic_abort BEFORE INSERT ON playback_session BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END"); db.close();
    await assert.rejects(store.write({ ...saved(), volume: 11 })); assert.deepEqual(await store.read(), saved());
    await assert.rejects(store.write({ ...saved(), cookie: 'synthetic-private-marker' } as StoredPlaybackSession));
    assert.equal((await readFile(file)).includes('synthetic-private-marker'), false);
  } finally { await store.close(); await rm(directory, { recursive: true, force: true }); }
});

test('损坏、未知版本的数据库保留原文件，保存控制器显示错误且不覆盖', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'starsmusic-playback-corrupt-')); const file = path.join(directory, 'playback.sqlite');
  try {
    for (const mode of ['version', 'corrupt']) {
      if (mode === 'version') {
        const initial = new SqlitePlaybackSessionStore(file); await initial.write(saved()); await initial.close();
        const db = new DatabaseSync(file); db.exec('PRAGMA user_version=99'); db.close();
      } else await writeFile(file, 'synthetic broken database');
      const before = await readFile(file); const player = new MusicPlayer(); const session = new PlaybackSession(player, new SqlitePlaybackSessionStore(file));
      await session.initialize(neverResolve); assert.equal(player.snapshot().saveError?.code, 'playback-save-failed');
      await player.setVolume(23); await session.close(); await player.dispose(); assert.deepEqual(await readFile(file), before);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('恢复不自动取链/播放，不公开路径/账号，原账号断连保留停放队列，换账号清理对应曲目', async () => {
  const player = new MusicPlayer(); let calls = 0;
  try {
    player.restoreSession(saved(), async () => { calls++; throw new DomainError('playback-login-required'); });
    assert.equal(player.snapshot().status, 'paused'); assert.equal(player.snapshot().positionSeconds, 12); assert.equal(calls, 0);
    assert.equal(player.snapshot().volume, 63); assert.equal(player.snapshot().muted, true);
    const snapshot = JSON.stringify(player.snapshot()); assert.equal(snapshot.includes('/tmp/'), false); assert.equal(snapshot.includes('accountId'), false);
    await player.clearRemote('netease', true); await player.clearRemote('kugou', true); assert.equal(player.snapshot().queue.length, 3);
    await player.resume(); assert.equal(calls, 1); assert.equal(player.snapshot().error?.code, 'playback-login-required');
    assert.equal(player.exportSession().positionSeconds, 12); // 未登录失败不丢书签。
    await player.seek(17); assert.equal(player.exportSession().positionSeconds, 17);
    await player.bindRestoredProvider('kugou', '84'); await player.clearRemote('kugou', true); assert.equal(player.snapshot().queue.length, 2);
    await player.bindRestoredProvider('netease', '99'); assert.equal(player.snapshot().currentIndex, null); assert.equal(player.snapshot().queue.length, 1);
  } finally { await player.dispose(); }
});

test('退出清除原账号队列，重新排序/移除后保存，零音量重启仍恢复此前非零音量', async () => {
  const first = new MusicPlayer(); const second = new MusicPlayer();
  try {
    first.restoreSession(saved(), neverResolve); await first.setVolume(78); await first.setVolume(0);
    first.moveNext('local-1'); await first.clearRemote('kugou');
    const state = first.exportSession(); assert.deepEqual(state.queue.map(track => track.id), ['online-1', 'local-1']);
    second.restoreSession(state, neverResolve); await second.setMuted(false); assert.equal(second.snapshot().volume, 78);
    await second.clearRemote('netease'); assert.deepEqual(second.exportSession().queue.map(track => track.kind), ['local']);
  } finally { await first.dispose(); await second.dispose(); }
});

test('保存合并快速更新，写入失败真实提示且下一次操作可重试，关闭冲刷最新状态', async () => {
  let value: StoredPlaybackSession | undefined; let writes = 0; let fail = true;
  const store: PlaybackSessionStore = { read: async () => undefined, close: async () => undefined, write: async state => { writes++; if (fail) throw new Error('synthetic disk failure'); value = state; } };
  const player = new MusicPlayer(); const session = new PlaybackSession(player, store);
  try {
    await session.initialize(neverResolve);
    for (let i = 0; i < 30; i++) await player.setVolume(i);
    await delay(260); assert.equal(writes, 1); assert.equal(player.snapshot().saveError?.code, 'playback-save-failed');
    fail = false; await player.setVolume(87); await session.close();
    assert.equal(value?.volume, 87); assert.equal(player.snapshot().saveError, undefined);
  } finally { await session.close(); await player.dispose(); }
});
