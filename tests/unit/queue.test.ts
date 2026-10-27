import assert from 'node:assert/strict';
import test from 'node:test';
import { MusicPlayer } from '../../packages/playback/src/player.ts';
import { parsePlaybackArgument, playbackChannels } from '../../packages/contracts/src/playback.ts';
import { neteaseChannels, parseNeteaseArguments } from '../../packages/contracts/src/netease.ts';
import { kugouChannels, parseKugouArguments } from '../../packages/contracts/src/kugou.ts';

test('下一首、移除和清空仅接受已定义 IPC 参数', () => {
  assert.equal(parsePlaybackArgument(playbackChannels.moveNext, ['registered']), 'registered');
  assert.equal(parsePlaybackArgument(playbackChannels.removeTrack, ['registered']), 'registered');
  assert.equal(parsePlaybackArgument(playbackChannels.clearUpcoming, []), undefined);
  assert.throws(() => parsePlaybackArgument(playbackChannels.moveNext, ['id', 'extra']));
  assert.throws(() => parsePlaybackArgument(playbackChannels.clearUpcoming, ['id']));
  assert.deepEqual(parseNeteaseArguments(neteaseChannels.enqueueNext, ['123']), { id: '123' });
  assert.throws(() => parseNeteaseArguments(neteaseChannels.enqueueNext, ['https://arbitrary.invalid']));
  assert.deepEqual(parseKugouArguments(kugouChannels.enqueueNext, ['hash_123']), { id: 'hash_123' });
});

test('队列插队保留当前项，切换歌单后解析仍惰性执行，退出只移除对应来源', async () => {
  const player = new MusicPlayer();
  let resolved = 0;
  const resolve = async (): Promise<never> => { resolved++; throw new Error('synthetic unavailable'); };
  try {
    // 缺失文件只建立登记队列，不启动 mpv；此处验证队列行为。
    await player.openFiles(['/tmp/starsmusic-queue-missing-a.wav', '/tmp/starsmusic-queue-missing-b.wav', '/tmp/starsmusic-queue-missing-c.wav']);
    const [a, b, c] = player.snapshot().queue;
    const generation = player.snapshot().generation;
    player.moveNext(c!.id);
    assert.deepEqual(player.snapshot().queue.map((t) => t.id), [a!.id, c!.id, b!.id]);
    assert.equal(player.snapshot().currentIndex, 0);
    assert.equal(player.snapshot().generation, generation);
    player.enqueueRemoteNext('netease', '云端 A', resolve);
    player.enqueueRemoteNext('kugou', '云端 B', resolve);
    assert.equal(resolved, 0);
    assert.deepEqual(player.snapshot().queue.map((t) => t.title), [a!.title, '云端 B', '云端 A', c!.title, b!.title]);
    await player.clearRemote('netease');
    assert.deepEqual(player.snapshot().queue.map((t) => t.provider), ['local', 'kugou', 'local', 'local']);
    assert.equal(player.snapshot().currentIndex, 0);
    player.removeTrack(c!.id);
    player.removeTrack(a!.id);
    assert.equal(player.snapshot().queue.length, 3);
    player.clearUpcoming();
    assert.deepEqual(player.snapshot().queue.map((t) => t.id), [a!.id]);
    assert.equal(resolved, 0);
  } finally { await player.dispose(); }
});

test('移除当前项之前的曲目会重定位索引；在线退出不会清空其他来源', async () => {
  const player = new MusicPlayer();
  try {
    await player.openFiles(['/tmp/starsmusic-queue-missing-a.wav', '/tmp/starsmusic-queue-missing-b.wav']);
    const [a, b] = player.snapshot().queue;
    await player.playTrack(b!.id);
    player.removeTrack(a!.id);
    assert.equal(player.snapshot().currentIndex, 0);
    await player.openRemote('netease', '合成在线项', async () => { throw new Error('synthetic'); });
    player.enqueueRemoteNext('kugou', '保留项', async () => { throw new Error('synthetic'); });
    await player.clearRemote('netease');
    assert.equal(player.snapshot().currentIndex, null);
    assert.equal(player.snapshot().status, 'idle');
    assert.deepEqual(player.snapshot().queue.map((t) => t.title), [b!.title, '保留项']);
  } finally { await player.dispose(); }
});

test('整张在线歌单原子替换队列，超过 200 首仍完整且仅按需取链', async () => {
  const player = new MusicPlayer(); const calls: number[] = [];
  try {
    await player.openRemoteList('netease', Array.from({ length: 350 }, (_, index) => ({ title: `合成曲目 ${index}`, sourceId: String(index), resolve: async () => { calls.push(index); throw new Error('synthetic unavailable'); } })));
    assert.equal(player.snapshot().queue.length, 350);
    assert.equal(player.snapshot().queue[349]?.sourceId, '349');
    assert.deepEqual(calls, [0]);
    await player.playTrack(player.snapshot().queue[201]!.id);
    assert.deepEqual(calls, [0, 201]);
    await player.clearRemote('netease'); assert.equal(player.snapshot().queue.length, 0);
  } finally { await player.dispose(); }
});
