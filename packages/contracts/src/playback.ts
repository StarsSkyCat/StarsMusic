import { parseAppError, type AppError } from './errors.ts';
import { choice, ContractValidationError, nonNegativeInteger, record, text } from './validation.ts';

export const playbackChannels = {
  getState: 'starsmusic:playback:get-state',
  openFiles: 'starsmusic:playback:open-files',
  playTrack: 'starsmusic:playback:play-track',
  moveNext: 'starsmusic:playback:move-next',
  removeTrack: 'starsmusic:playback:remove-track',
  clearUpcoming: 'starsmusic:playback:clear-upcoming',
  resume: 'starsmusic:playback:resume',
  pause: 'starsmusic:playback:pause',
  stop: 'starsmusic:playback:stop',
  seek: 'starsmusic:playback:seek',
  setVolume: 'starsmusic:playback:set-volume',
  stateChanged: 'starsmusic:playback:state-changed',
} as const;

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
  readonly engineVersion?: string;
  readonly audioOutput?: string;
  readonly error?: AppError;
}

export interface PlaybackApi {
  getState(): Promise<PlaybackSnapshot>;
  openFiles(): Promise<PlaybackSnapshot>;
  playTrack(id: string): Promise<PlaybackSnapshot>;
  moveNext(id: string): Promise<PlaybackSnapshot>;
  removeTrack(id: string): Promise<PlaybackSnapshot>;
  clearUpcoming(): Promise<PlaybackSnapshot>;
  resume(): Promise<PlaybackSnapshot>;
  pause(): Promise<PlaybackSnapshot>;
  stop(): Promise<PlaybackSnapshot>;
  seek(seconds: number): Promise<PlaybackSnapshot>;
  setVolume(volume: number): Promise<PlaybackSnapshot>;
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
    volume: playbackNumber(input.volume, 100),
    ...(input.engineVersion === undefined ? {} : { engineVersion: text(input.engineVersion, 'playback.engineVersion') }),
    ...(input.audioOutput === undefined ? {} : { audioOutput: text(input.audioOutput, 'playback.audioOutput') }),
    ...(input.error === undefined ? {} : { error: parseAppError(input.error) }),
  });
}

export function parsePlaybackArgument(command: string, args: readonly unknown[]): string | number | undefined {
  const trackCommands: readonly string[] = [playbackChannels.playTrack, playbackChannels.moveNext, playbackChannels.removeTrack];
  if (trackCommands.includes(command) && args.length === 1) return text(args[0], 'playback.trackId');
  if (command === playbackChannels.seek && args.length === 1) return playbackNumber(args[0]);
  if (command === playbackChannels.setVolume && args.length === 1) return playbackNumber(args[0], 100);
  const noArguments: readonly string[] = [playbackChannels.getState, playbackChannels.openFiles,
    playbackChannels.resume, playbackChannels.pause, playbackChannels.stop, playbackChannels.clearUpcoming];
  if (noArguments.includes(command) && args.length === 0) return undefined;
  throw new ContractValidationError('playback.command');
}
