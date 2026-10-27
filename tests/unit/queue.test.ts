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

test('未播放时也保留音量与独立静音，零音量取消静音恢复上次非零值', async () => {
  const player = new MusicPlayer();
  try {
    await player.setVolume(83); await player.setMuted(true);
    assert.equal(player.snapshot().volume,83); assert.equal(player.snapshot().muted,true);
    await player.setMuted(false); assert.equal(player.snapshot().volume,83);
    await player.setVolume(0); await player.setMuted(false); assert.equal(player.snapshot().volume,83);
    await Promise.all([player.setVolume(10),player.setVolume(45),player.setVolume(91)]);
    assert.equal(player.snapshot().volume,91); assert.equal(player.snapshot().muted,false);
  } finally {await player.dispose();}
});

test('随机队列一轮无重复、保留当前曲目和代次，关闭恢复原序，循环切歌且停放不启动音频', async () => {
  const player = new MusicPlayer(); const restored = new MusicPlayer();
  try {
    await player.openFiles(Array.from({ length: 12 }, (_, i) => `/tmp/starsmusic-mode-missing-${i}.wav`));
    const original = player.snapshot().queue.map(track => track.id);
    await player.cueTrack(original[5]!); const generation = player.snapshot().generation;
    player.setShuffle(true);
    const shuffled = player.snapshot().queue.map(track => track.id);
    assert.equal(shuffled[0], original[5]); assert.equal(player.snapshot().generation, generation);
    assert.deepEqual([...shuffled].sort(), [...original].sort());
    player.setLoopMode('playlist');
    // 真实 SQLite 存储的同一契约；恢复不取链、不启动音频。
    restored.restoreSession(player.exportSession(), async () => { throw new Error('not requested'); });
    assert.equal(restored.snapshot().shuffle, true); assert.equal(restored.snapshot().loopMode, 'playlist');
    assert.deepEqual(restored.snapshot().queue.map(track => track.id), shuffled);
    restored.setShuffle(false); assert.deepEqual(restored.snapshot().queue.map(track => track.id), original);
    const seen = [shuffled[0]];
    for (let i = 1; i < shuffled.length; i++) { await player.next(); seen.push(player.snapshot().queue[player.snapshot().currentIndex!]!.id); }
    assert.deepEqual(seen, shuffled); assert.equal(player.snapshot().status, 'idle');
    await player.next(); assert.equal(player.snapshot().currentIndex, 0);
    await player.previous(); assert.equal(player.snapshot().currentIndex, shuffled.length - 1);
    player.setLoopMode('track'); await player.previous(); assert.equal(player.snapshot().currentIndex, shuffled.length - 2);
    player.setShuffle(false); assert.deepEqual(player.snapshot().queue.map(track => track.id), original);
    player.setLoopMode('none'); await player.cueTrack(original.at(-1)!);
    const lastGeneration = player.snapshot().generation; await player.next(); assert.equal(player.snapshot().generation, lastGeneration);
    assert.throws(() => player.setLoopMode('invalid' as never)); assert.throws(() => player.setShuffle('true' as never));
  } finally { await player.dispose(); await restored.dispose(); }
});
