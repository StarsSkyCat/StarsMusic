import type { QueueTrack } from '../../../packages/contracts/src/playback';
export interface DisplayTrack extends QueueTrack {
  readonly durationSeconds?: number;
}
export function formatTime(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`;
}
