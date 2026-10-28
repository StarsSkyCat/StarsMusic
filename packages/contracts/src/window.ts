import { choice, ContractValidationError, record } from './validation.ts';

export const windowChannels = {
  getState: 'starsmusic:window:get-state',
  minimize: 'starsmusic:window:minimize',
  toggleMaximize: 'starsmusic:window:toggle-maximize',
  close: 'starsmusic:window:close',
  changed: 'starsmusic:window:changed',
} as const;
export type WindowCommand = 'getState' | 'minimize' | 'toggleMaximize' | 'close';
export interface WindowSnapshot {
  readonly platform: 'linux' | 'win32' | 'darwin' | 'other';
  readonly maximized: boolean;
  readonly fullscreen: boolean;
  readonly focused: boolean;
}
export interface WindowApi {
  getState(): Promise<WindowSnapshot>;
  minimize(): Promise<WindowSnapshot>;
  toggleMaximize(): Promise<WindowSnapshot>;
  close(): Promise<void>;
  onChanged(listener: (state: WindowSnapshot) => void): () => void;
}
export function parseWindowSnapshot(value: unknown): WindowSnapshot {
  const raw = record(value, 'window');
  for (const key of ['maximized', 'fullscreen', 'focused']) if (typeof raw[key] !== 'boolean') throw new ContractValidationError(`window.${key}`);
  return Object.freeze({ platform: choice(raw.platform, ['linux', 'win32', 'darwin', 'other'], 'window.platform'),
    maximized: raw.maximized as boolean, fullscreen: raw.fullscreen as boolean, focused: raw.focused as boolean });
}
export function parseWindowCommand(channel: string, args: readonly unknown[]): WindowCommand {
  if (args.length) throw new ContractValidationError('window.arguments');
  for (const command of ['getState', 'minimize', 'toggleMaximize', 'close'] as const) if (windowChannels[command] === channel) return command;
  throw new ContractValidationError('window.command');
}
