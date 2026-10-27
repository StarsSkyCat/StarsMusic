import { Tray, Menu, nativeImage, globalShortcut } from 'electron';
import type { DesktopRuntime } from '../runtime.ts';
import type { PlaybackSnapshot } from '../../../contracts/src/playback.ts';
import { trayIcon } from './tray-icon.ts';
export function electronDesktopRuntime(window: Pick<DesktopRuntime, 'show' | 'hide' | 'quit' | 'isVisible'>): DesktopRuntime {
  return { ...window,
    registerShortcut: (accelerator, action) => globalShortcut.register(accelerator, action),
    unregisterShortcut: accelerator => globalShortcut.unregister(accelerator),
    createTray(action) {
      const image = nativeImage.createFromDataURL(trayIcon); if (image.isEmpty()) throw new Error('desktop.tray-icon');
      const tray = new Tray(image); let key = '';
      tray.setToolTip('StarsMusic'); tray.on('click', () => action('show')); tray.on('double-click', () => action('show'));
      return { destroy: () => { if (!tray.isDestroyed()) tray.destroy(); }, update(state: PlaybackSnapshot) {
        if (tray.isDestroyed()) return;
        const track = state.queue[state.currentIndex ?? -1];
        const next = JSON.stringify([track?.title, state.status, state.currentIndex, state.queue.length, state.muted, state.volume === 0]);
        if (key === next) return; key = next;
        tray.setToolTip((track ? `${track.title} · StarsMusic` : 'StarsMusic').slice(0, 128));
        tray.setContextMenu(Menu.buildFromTemplate([
          { label: '显示 StarsMusic', click: () => action('show') }, { label: (track?.title ?? '尚未播放').slice(0, 100), enabled: false }, { type: 'separator' },
          { label: state.status === 'playing' ? '暂停' : '播放', enabled: state.queue.length > 0 && state.status !== 'loading', click: () => action('toggle') },
          { label: '上一首', enabled: state.currentIndex !== null && state.currentIndex > 0, click: () => action('previous') },
          { label: '下一首', enabled: state.currentIndex !== null && state.currentIndex + 1 < state.queue.length, click: () => action('next') },
          { label: '静音', type: 'checkbox', checked: state.muted || state.volume === 0, click: () => action('mute') },
          { type: 'separator' }, { label: '隐藏窗口', click: () => action('hide') }, { label: '退出 StarsMusic', click: () => action('quit') },
        ]));
      } };
    },
  };
}
