import { capability, type DesktopServices } from '../platform.ts';

// Windows 托盘/快捷键交由 Electron runtime 实际创建或注册；不启动 Linux D-Bus 服务。
export function windowsDesktop(): DesktopServices {
  const linuxOnly = capability('unavailable', '此接口仅用于 Linux 桌面');
  return {
    session: 'unknown', desktop: 'Windows', bus: linuxOnly, mpris: linuxOnly, portal: linuxOnly,
    notifications: capability('unavailable', 'Windows 原生通知尚未接入'),
    trayHost: capability('unknown', '等待创建 Windows 通知区域图标'),
    globalShortcuts: capability('unknown', '需按每个快捷键的实际注册结果确认'),
  };
}
