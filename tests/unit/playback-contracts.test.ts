import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePlaybackArgument, parsePlaybackSnapshot, playbackChannels } from '../../packages/contracts/src/playback.ts';
import { ContractValidationError } from '../../packages/contracts/src/validation.ts';

test('播放 IPC 只接受具体命令、有限数值与已定义参数数量', () => {
  assert.equal(parsePlaybackArgument(playbackChannels.seek, [12.5]), 12.5);
  assert.equal(parsePlaybackArgument(playbackChannels.playTrack, ['registered-id']), 'registered-id');
  assert.equal(parsePlaybackArgument(playbackChannels.openFiles, []), undefined);
  for (const [command, args] of [
    [playbackChannels.openFiles, ['/tmp/arbitrary.wav']],
    [playbackChannels.seek, [NaN]], [playbackChannels.seek, [-1]],
    [playbackChannels.setVolume, [101]], [playbackChannels.setVolume, [Infinity]],
    [playbackChannels.playTrack, []], [playbackChannels.playTrack, [1]],
    [playbackChannels.pause, ['extra']], ['arbitrary-mpv-command', []],
  ] as const) assert.throws(() => parsePlaybackArgument(command, args), ContractValidationError);
});

test('播放快照过滤本地路径并拒绝无效队列、索引、状态与数值', () => {
  const snapshot = {
    revision: 2, generation: 1, status: 'playing', queue: [{ id: 'a', title: 'sample.wav' }],
    currentIndex: 0, positionSeconds: 1.5, durationSeconds: 30, volume: 70, muted: false,
  };
  assert.deepEqual(parsePlaybackSnapshot({ ...snapshot, queue: [{ ...snapshot.queue[0], path: 'synthetic-private-path' }] }), snapshot);
  for (const invalid of [
    { ...snapshot, queue: [{ id: 'a', title: 'one' }, { id: 'a', title: 'two' }] },
    { ...snapshot, currentIndex: 1 }, { ...snapshot, currentIndex: null },
    { ...snapshot, revision: -1 }, { ...snapshot, positionSeconds: Infinity },
    { ...snapshot, volume: 101 }, { ...snapshot, status: 'fake-playing' },
  ]) assert.throws(() => parsePlaybackSnapshot(invalid), ContractValidationError);
});

test('静音仅接受显式布尔值，缺省旧快照保持未静音', () => {
  assert.equal(parsePlaybackArgument(playbackChannels.setMuted, [true]), true);
  for (const args of [[], ['true'], [1], [true, false]]) assert.throws(() => parsePlaybackArgument(playbackChannels.setMuted, args));
});
