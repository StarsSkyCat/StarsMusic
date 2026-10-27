import { parseAppError, type AppError } from './errors.ts';
import { choice, ContractValidationError, nonNegativeInteger, record, text } from './validation.ts';

export const playbackChannels = {
  getState: 'starsmusic:playback:get-state',
  openFiles: 'starsmusic:playback:open-files',
  playTrack: 'starsmusic:playback:play-track',
  moveNext: 'starsmusic:playback:move-next',
  removeTrack: 'starsmusic:playback:remove-track',
  clearUpcoming: 'starsmusic:playback:clear-upcoming',
  next: 'starsmusic:playback:next', previous: 'starsmusic:playback:previous',
  setLoopMode: 'starsmusic:playback:set-loop-mode', setShuffle: 'starsmusic:playback:set-shuffle',
  setMode: 'starsmusic:playback:set-mode',
  resume: 'starsmusic:playback:resume',
  pause: 'starsmusic:playback:pause',
  stop: 'starsmusic:playback:stop',
  seek: 'starsmusic:playback:seek',
  setVolume: 'starsmusic:playback:set-volume', setMuted: 'starsmusic:playback:set-muted',
  stateChanged: 'starsmusic:playback:state-changed',
} as const;

export type LoopMode = 'none' | 'playlist' | 'track';
export type PlaybackMode = 'playlist' | 'shuffle' | 'track';
export function parsePlaybackMode(value: unknown): PlaybackMode {
  return choice(value, ['playlist', 'shuffle', 'track'], 'playback.mode');
}
export function parseLoopMode(value: unknown): LoopMode {
  return choice(value, ['none', 'playlist', 'track'], 'playback.loopMode');
}
export function adjacentIndex(state: Pick<PlaybackSnapshot, 'queue' | 'currentIndex' | 'loopMode'>, offset: 1 | -1): number | null {
  if (state.currentIndex === null || !state.queue.length) return null;
  const index = state.currentIndex + offset;
  if (index >= 0 && index < state.queue.length) return index;
  return state.loopMode === 'none' ? null : (index + state.queue.length) % state.queue.length;
}

export interface QueueTrack {
  readonly id: string;
  readonly title: string;
  readonly provider?: 'local' | 'netease' | 'kugou';
  readonly artist?: string;
  readonly sourceId?: string;
  readonly detail?: string;
}

export interface PlaybackSnapshot {
  readonly revision: number;
  readonly generation: number;
  readonly status: 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';
  readonly queue: readonly QueueTrack[];
  readonly currentIndex: number | null;
  readonly positionSeconds: number;
  readonly durationSeconds: number;
  readonly volume: number;
  readonly muted: boolean;
  readonly loopMode: LoopMode;
  readonly shuffle: boolean;
  readonly engineVersion?: string;
  readonly audioOutput?: string;
  readonly error?: AppError;
  readonly saveError?: AppError;
}

export interface PlaybackApi {
  getState(): Promise<PlaybackSnapshot>;
  openFiles(): Promise<PlaybackSnapshot>;
  playTrack(id: string): Promise<PlaybackSnapshot>;
  moveNext(id: string): Promise<PlaybackSnapshot>;
  removeTrack(id: string): Promise<PlaybackSnapshot>;
  clearUpcoming(): Promise<PlaybackSnapshot>;
  next(): Promise<PlaybackSnapshot>;
  previous(): Promise<PlaybackSnapshot>;
  setLoopMode(mode: LoopMode): Promise<PlaybackSnapshot>;
  setShuffle(enabled: boolean): Promise<PlaybackSnapshot>;
  setMode(mode: PlaybackMode): Promise<PlaybackSnapshot>;
  resume(): Promise<PlaybackSnapshot>;
  pause(): Promise<PlaybackSnapshot>;
  stop(): Promise<PlaybackSnapshot>;
  seek(seconds: number): Promise<PlaybackSnapshot>;
  setVolume(volume: number): Promise<PlaybackSnapshot>;
  setMuted(muted: boolean): Promise<PlaybackSnapshot>;
  onStateChanged(listener: (snapshot: PlaybackSnapshot) => void): () => void;
}

export function playbackNumber(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum) {
    throw new ContractValidationError('playback.number');
  }
  return value;
}

export function parsePlaybackSnapshot(value: unknown): PlaybackSnapshot {
  const input = record(value, 'playback');
  if (input.muted !== undefined && typeof input.muted !== 'boolean') throw new ContractValidationError('playback.muted');
  if (input.shuffle !== undefined && typeof input.shuffle !== 'boolean') throw new ContractValidationError('playback.shuffle');
  const requestedLoop = input.loopMode === undefined ? 'playlist' : parseLoopMode(input.loopMode);
  if (!Array.isArray(input.queue) || input.queue.length > 10000) throw new ContractValidationError('playback.queue');
  const queue = input.queue.map((value: unknown) => {
    const item = record(value, 'playback.queue.item');
    return Object.freeze({ id: text(item.id, 'playback.queue.id'), title: text(item.title, 'playback.queue.title'),
      ...(item.provider === undefined ? {} : { provider: choice(item.provider, ['local', 'netease', 'kugou'], 'playback.queue.provider') }),
      ...(item.sourceId === undefined ? {} : { sourceId: text(item.sourceId, 'playback.queue.sourceId') }),
      ...(item.artist === undefined ? {} : { artist: text(item.artist, 'playback.queue.artist') }),
      ...(item.detail === undefined ? {} : { detail: text(item.detail, 'playback.queue.detail') }),
    });
  });
  if (new Set(queue.map((track) => track.id)).size !== queue.length) throw new ContractValidationError('playback.queue.id');
  const currentIndex = input.currentIndex === null ? null : nonNegativeInteger(input.currentIndex, 'playback.currentIndex');
  if (currentIndex !== null && currentIndex >= queue.length) throw new ContractValidationError('playback.currentIndex');
  const status = choice(input.status, ['idle', 'loading', 'playing', 'paused', 'ended', 'error'], 'playback.status');
  if (['loading', 'playing', 'paused', 'ended'].includes(status) && currentIndex === null) {
    throw new ContractValidationError('playback.currentIndex');
  }
  return Object.freeze({
    revision: nonNegativeInteger(input.revision, 'playback.revision'),
    generation: nonNegativeInteger(input.generation, 'playback.generation'),
    status, queue: Object.freeze(queue), currentIndex,
    positionSeconds: playbackNumber(input.positionSeconds),
    durationSeconds: playbackNumber(input.durationSeconds),
    volume: playbackNumber(input.volume, 100), muted: input.muted === true,
    // 兼容旧的独立开关记录：随机优先；旧顺序模式迁为列表循环。
    loopMode: input.shuffle === true ? 'none' : requestedLoop === 'none' ? 'playlist' : requestedLoop, shuffle: input.shuffle === true,
    ...(input.engineVersion === undefined ? {} : { engineVersion: text(input.engineVersion, 'playback.engineVersion') }),
    ...(input.audioOutput === undefined ? {} : { audioOutput: text(input.audioOutput, 'playback.audioOutput') }),
    ...(input.saveError === undefined ? {} : { saveError: parseAppError(input.saveError) }),
    ...(input.error === undefined ? {} : { error: parseAppError(input.error) }),
  });
}

export function parsePlaybackArgument(command: string, args: readonly unknown[]): string | number | boolean | undefined {
  const trackCommands: readonly string[] = [playbackChannels.playTrack, playbackChannels.moveNext, playbackChannels.removeTrack];
  if (trackCommands.includes(command) && args.length === 1) return text(args[0], 'playback.trackId');
  if (command === playbackChannels.setMuted && args.length === 1 && typeof args[0] === 'boolean') return args[0];
  if (command === playbackChannels.setShuffle && args.length === 1 && typeof args[0] === 'boolean') return args[0];
  if (command === playbackChannels.setLoopMode && args.length === 1) return parseLoopMode(args[0]);
  if (command === playbackChannels.setMode && args.length === 1) return parsePlaybackMode(args[0]);
  if (command === playbackChannels.seek && args.length === 1) return playbackNumber(args[0]);
  if (command === playbackChannels.setVolume && args.length === 1) return playbackNumber(args[0], 100);
  const noArguments: readonly string[] = [playbackChannels.getState, playbackChannels.openFiles,
    playbackChannels.resume, playbackChannels.pause, playbackChannels.stop, playbackChannels.clearUpcoming, playbackChannels.next, playbackChannels.previous];
  if (noArguments.includes(command) && args.length === 0) return undefined;
  throw new ContractValidationError('playback.command');
}
