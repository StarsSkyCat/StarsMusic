import type { LoopMode, PlaybackSnapshot } from '../../contracts/src/playback.ts';
import type { PresentationSnapshot } from '../../contracts/src/presentation.ts';

import type { CapabilityState, Capability } from '../../contracts/src/system.ts';
export type { CapabilityState, Capability } from '../../contracts/src/system.ts';
export interface DesktopServices {
  session: 'wayland' | 'x11' | 'unknown'; desktop: string;
  bus: Capability; mpris: Capability; notifications: Capability; trayHost: Capability; portal: Capability; globalShortcuts: Capability;
  mprisName?: string | undefined; portalVersion?: number | undefined; portalOwner?: string | undefined; trayRegistered?: boolean | undefined;
}
export interface PlaybackPort {
  snapshot(): PlaybackSnapshot;
  subscribe(listener: (snapshot: PlaybackSnapshot) => void): () => void;
  subscribeSeeked(listener: (seconds: number) => void): () => void;
  playTrack(id: string, paused?: boolean): Promise<PlaybackSnapshot>;
  cueTrack(id: string): Promise<PlaybackSnapshot>;
  next(): Promise<PlaybackSnapshot>; previous(): Promise<PlaybackSnapshot>;
  setLoopMode(mode: LoopMode): PlaybackSnapshot; setShuffle(enabled: boolean): PlaybackSnapshot;
  resume(): Promise<PlaybackSnapshot>; pause(): Promise<PlaybackSnapshot>; stop(): Promise<PlaybackSnapshot>;
  seek(seconds: number): Promise<PlaybackSnapshot>; setVolume(volume: number): Promise<PlaybackSnapshot>; setMuted(muted: boolean): Promise<PlaybackSnapshot>;
}
export interface WindowPort { show(): void; quit(): void }
export interface PresentationPort {
  snapshot(): PresentationSnapshot;
  subscribe(listener: (snapshot: PresentationSnapshot) => void): () => void;
}
export interface PlatformIntegration {
  initialize(): Promise<void>;
  snapshot(): DesktopServices;
  subscribe(listener: (state: DesktopServices) => void): () => void;
  refresh(): Promise<DesktopServices>;
  dispose(): Promise<void>;
}
export function capability(state: CapabilityState, detail: string): Capability { return { state, detail }; }
export function desktopEnvironment(env: NodeJS.ProcessEnv): Pick<DesktopServices, 'session' | 'desktop'> {
  const declared = env.XDG_SESSION_TYPE?.toLowerCase();
  return { session: declared === 'wayland' || declared === 'x11' ? declared : 'unknown',
    desktop: (env.XDG_CURRENT_DESKTOP ?? '未声明桌面').replace(/[^\p{L}\p{N}_: .-]/gu, '').slice(0, 80) || '未声明桌面' };
}
export async function adjacent(player: PlaybackPort, offset: number): Promise<void> {
  if (offset === 1) await player.next();
  else if (offset === -1) await player.previous();
}
export async function togglePlayback(player: PlaybackPort): Promise<void> {
  const state = player.snapshot();
  if (state.status === 'loading') return;
  if (state.status === 'playing') await player.pause();
  else if (state.currentIndex === null && state.queue[0]) await player.playTrack(state.queue[0].id);
  else await player.resume();
}
