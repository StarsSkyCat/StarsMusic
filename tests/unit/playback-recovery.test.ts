import assert from 'node:assert/strict';
import test from 'node:test';
import { DomainError, type ErrorCode } from '../../packages/contracts/src/errors.ts';
import { MusicPlayer } from '../../packages/playback/src/player.ts';

const flush = () => new Promise<void>(done => setImmediate(done));
function failingTracks(calls: string[], codes: ErrorCode[] = ['unavailable', 'permission-denied', 'track-mismatch']) {
  return codes.map((code, index) => ({ title: `合成失败曲目 ${index}`, sourceId: String(index), accountId: 'synthetic-account',
    resolve: async (): Promise<never> => { calls.push(String(index)); throw new DomainError(code); } }));
}

test('资源失败保留错误 2.5 秒再续播，三种模式均跳过失败项且整队失败只尝试一轮', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const mode of ['playlist', 'track', 'shuffle'] as const) {
    const player = new MusicPlayer(); const calls: string[] = [];
    try {
      player.setMode(mode);
      await player.openRemoteList('netease', failingTracks(calls));
      const order = player.snapshot().queue.map(track => track.sourceId);
      assert.deepEqual(calls, [order[0]]);
      assert.equal(player.snapshot().status, 'error');
      assert.equal(player.snapshot().error?.code, ['unavailable', 'permission-denied', 'track-mismatch'][Number(order[0])]);
      t.mock.timers.tick(2499); await flush(); assert.equal(calls.length, 1);
      t.mock.timers.tick(1); await flush(); assert.deepEqual(calls, order.slice(0, 2));
      t.mock.timers.tick(2500); await flush(); assert.deepEqual(calls, order);
      t.mock.timers.tick(30000); await flush(); assert.deepEqual(calls, order);
      assert.equal(player.snapshot().status, 'error');
    } finally { await player.dispose(); }
  }
});

test('暂停、停止、停放、上一首/下一首、退出当前平台和销毁都会取消错误后的自动播放', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const action of ['pause', 'stop', 'cue', 'previous', 'next', 'logout', 'dispose'] as const) {
    const player = new MusicPlayer(); const calls: string[] = [];
    try {
      await player.openRemoteList('netease', failingTracks(calls));
      if (action === 'cue') await player.cueTrack(player.snapshot().queue[1]!.id);
      else if (action === 'logout') await player.clearRemote('netease');
      else await player[action]();
      t.mock.timers.tick(10000); await flush();
      assert.deepEqual(calls, ['0'], action);
    } finally { await player.dispose(); }
  }
});

test('手动切歌和替换队列使旧计时器失效，新失败从本次开始等待', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const replace of [false, true]) {
    const player = new MusicPlayer(); const calls: string[] = [];
    try {
      await player.openRemoteList('netease', failingTracks(calls));
      t.mock.timers.tick(1000);
      if (replace) await player.openRemoteList('kugou', failingTracks(calls));
      else await player.playTrack(player.snapshot().queue[1]!.id);
      const expected = replace ? ['0', '0'] : ['0', '1'];
      t.mock.timers.tick(1500); await flush(); assert.deepEqual(calls, expected);
      t.mock.timers.tick(999); await flush(); assert.deepEqual(calls, expected);
      t.mock.timers.tick(1); await flush(); assert.deepEqual(calls, [...expected, replace ? '1' : '2']);
    } finally { await player.dispose(); }
  }
});

test('等待期间调整队列使用最新顺序，删除待播曲目后不会播放过期项', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const player = new MusicPlayer(); const calls: string[] = [];
  try {
    await player.openRemoteList('netease', failingTracks(calls));
    player.moveNext(player.snapshot().queue[2]!.id);
    player.removeTrack(player.snapshot().queue[2]!.id);
    t.mock.timers.tick(2500); await flush(); assert.deepEqual(calls, ['0', '2']);
    t.mock.timers.tick(10000); await flush(); assert.deepEqual(calls, ['0', '2']);
    await player.openRemoteList('netease', failingTracks(calls));
    player.clearUpcoming();
    t.mock.timers.tick(10000); await flush(); assert.deepEqual(calls, ['0', '2', '0']);
  } finally { await player.dispose(); }
});

test('登录、授权验证、限流、取消和引擎错误不触发逐曲请求；单首失败不重试自身', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const codes: ErrorCode[] = ['unauthenticated', 'session-expired', 'verification-required', 'rate-limited', 'playback-login-required', 'engine-unavailable', 'cancelled', 'stale-operation'];
  const player = new MusicPlayer();
  try {
    for (const code of codes) {
      const calls: string[] = [];
      await player.openRemoteList('netease', failingTracks(calls, [code, 'unavailable']));
      t.mock.timers.tick(10000); await flush(); assert.deepEqual(calls, ['0'], code);
    }
    const calls: string[] = [];
    await player.openRemoteList('netease', failingTracks(calls, ['unavailable']));
    t.mock.timers.tick(10000); await flush(); assert.deepEqual(calls, ['0']);
  } finally { await player.dispose(); }
});
