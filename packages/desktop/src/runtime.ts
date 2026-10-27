import type { PlaybackSnapshot } from '../../contracts/src/playback.ts';
import type { ShortcutId } from '../../contracts/src/system.ts';
import type { WindowPort } from './platform.ts';
export interface TrayPort { update(state: PlaybackSnapshot): void; destroy(): void }
export interface DesktopRuntime extends WindowPort {
  isVisible(): boolean;
  createTray(action: (id: ShortcutId | 'quit' | 'hide') => void): TrayPort;
  registerShortcut(accelerator: string, action: () => void): boolean;
  unregisterShortcut(accelerator: string): void;
  hide(): void;
}
