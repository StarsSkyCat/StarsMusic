import type { PlaybackApi } from './playback.ts';
import type { CredentialsApi } from './credentials.ts';
import type { KugouApi } from './kugou.ts';
import type { NeteaseApi } from './netease.ts';

export const desktopChannels = {
  getAppInfo: 'starsmusic:app:get-info',
} as const;

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
  arch: string;
  electron: string;
  chromium: string;
  node: string;
}

export interface DesktopApi {
  getAppInfo(): Promise<AppInfo>;
  readonly playback: PlaybackApi;
  readonly netease: NeteaseApi;
  readonly kugou: KugouApi;
  readonly credentials: CredentialsApi;
}

export function parseAppInfo(value: unknown): AppInfo {
  if (typeof value !== 'object' || value === null) throw new Error('应用信息格式无效');
  const fields = ['name', 'version', 'platform', 'arch', 'electron', 'chromium', 'node'] as const;
  for (const field of fields) {
    if (!(field in value) || typeof Reflect.get(value, field) !== 'string'
      || Reflect.get(value, field).length === 0) throw new Error('应用信息格式无效');
  }
  // 只返回白名单字段，避免后续后台扩展意外泄露到界面。
  const info = value as Record<keyof AppInfo, string>;
  return {
    name: info.name, version: info.version, platform: info.platform, arch: info.arch,
    electron: info.electron, chromium: info.chromium, node: info.node,
  };
}
