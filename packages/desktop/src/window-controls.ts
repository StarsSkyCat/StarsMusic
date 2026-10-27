import type { WindowCommand, WindowSnapshot } from '../../contracts/src/window.ts';

export interface WindowPort {
  isMaximized(): boolean;
  isFullScreen(): boolean;
  isFocused(): boolean;
  minimize(): void;
  maximize(): void;
  unmaximize(): void;
  setFullScreen(enabled: boolean): void;
  close(): void;
}
export function windowChrome(platform: string) {
  // macOS 保留原生交通灯；Linux/Windows 使用共享的应用内窗口控制。
  return platform === 'darwin'
    ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 24, y: 18 } }
    : { frame: false };
}
export function windowSnapshot(window: WindowPort, platform: string): WindowSnapshot {
  return { platform: platform === 'linux' || platform === 'win32' || platform === 'darwin' ? platform : 'other',
    maximized: window.isMaximized(), fullscreen: window.isFullScreen(), focused: window.isFocused() };
}
export function controlWindow(window: WindowPort, command: WindowCommand): void {
  if (command === 'minimize') window.minimize();
  else if (command === 'toggleMaximize') {
    if (window.isFullScreen()) window.setFullScreen(false);
    else if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  } else if (command === 'close') window.close();
}
