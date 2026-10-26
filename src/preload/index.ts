import { contextBridge, ipcRenderer } from 'electron';
import { desktopChannels, parseAppInfo, type DesktopApi } from '../../packages/contracts/src/desktop';
import { playbackChannels, parsePlaybackSnapshot } from '../../packages/contracts/src/playback';
import { neteaseChannels, parseNeteaseSnapshot } from '../../packages/contracts/src/netease';

const invokePlayback = async (channel: string, ...args: unknown[]) => {
  const value: unknown = await ipcRenderer.invoke(channel, ...args);
  return parsePlaybackSnapshot(value);
};
const invokeNetease = async (channel: string, ...args: unknown[]) => {
  const value: unknown = await ipcRenderer.invoke(channel, ...args);
  return parseNeteaseSnapshot(value);
};

const api: DesktopApi = Object.freeze({
  async getAppInfo() {
    const response: unknown = await ipcRenderer.invoke(desktopChannels.getAppInfo);
    return parseAppInfo(response);
  },
  playback: Object.freeze({
    getState: () => invokePlayback(playbackChannels.getState),
    openFiles: () => invokePlayback(playbackChannels.openFiles),
    playTrack: (id: string) => invokePlayback(playbackChannels.playTrack, id),
    resume: () => invokePlayback(playbackChannels.resume),
    pause: () => invokePlayback(playbackChannels.pause),
    stop: () => invokePlayback(playbackChannels.stop),
    seek: (seconds: number) => invokePlayback(playbackChannels.seek, seconds),
    setVolume: (volume: number) => invokePlayback(playbackChannels.setVolume, volume),
    onStateChanged(listener: (snapshot: ReturnType<typeof parsePlaybackSnapshot>) => void) {
      if (typeof listener !== 'function') throw new Error('监听器无效');
      const receive = (_event: unknown, value: unknown) => listener(parsePlaybackSnapshot(value));
      ipcRenderer.on(playbackChannels.stateChanged, receive);
      return () => { ipcRenderer.removeListener(playbackChannels.stateChanged, receive); };
    },
  }),
  netease: Object.freeze({
    getState: () => invokeNetease(neteaseChannels.getState),
    startLogin: () => invokeNetease(neteaseChannels.startLogin),
    cancelLogin: () => invokeNetease(neteaseChannels.cancelLogin),
    logout: () => invokeNetease(neteaseChannels.logout),
    loadPlaylists: () => invokeNetease(neteaseChannels.loadPlaylists),
    loadPlaylist: (id: string, offset: number) => invokeNetease(neteaseChannels.loadPlaylist, id, offset),
    async playTrack(id: string): Promise<void> { await ipcRenderer.invoke(neteaseChannels.playTrack, id); },
    onStateChanged(listener: (state: ReturnType<typeof parseNeteaseSnapshot>) => void) {
      if (typeof listener !== 'function') throw new Error('监听器无效');
      const receive = (_event: unknown, value: unknown) => listener(parseNeteaseSnapshot(value));
      ipcRenderer.on(neteaseChannels.stateChanged, receive);
      return () => { ipcRenderer.removeListener(neteaseChannels.stateChanged, receive); };
    },
  }),
});

contextBridge.exposeInMainWorld('starsMusic', api);
