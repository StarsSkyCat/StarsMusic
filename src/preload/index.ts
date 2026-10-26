import { contextBridge, ipcRenderer } from 'electron';
import { desktopChannels, parseAppInfo, type DesktopApi } from '../../packages/contracts/src/desktop';
import { credentialChannels, parseCredentialStatus } from '../../packages/contracts/src/credentials';
import { playbackChannels, parsePlaybackSnapshot } from '../../packages/contracts/src/playback';
import { kugouChannels, parseKugouSnapshot } from '../../packages/contracts/src/kugou';
import { neteaseChannels, parseNeteaseSnapshot } from '../../packages/contracts/src/netease';

const invokePlayback = async (channel: string, ...args: unknown[]) => {
  const value: unknown = await ipcRenderer.invoke(channel, ...args);
  return parsePlaybackSnapshot(value);
};
const invokeNetease = async (channel: string, ...args: unknown[]) => {
  const value: unknown = await ipcRenderer.invoke(channel, ...args);
  return parseNeteaseSnapshot(value);
};

const invokeKugou = async (channel: string, ...args: unknown[]) => {
  const value: unknown = await ipcRenderer.invoke(channel, ...args);
  return parseKugouSnapshot(value);
};

const invokeCredentials = async (channel: string, ...args: unknown[]) => {
  const value: unknown = await ipcRenderer.invoke(channel, ...args);
  return parseCredentialStatus(value);
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
    moveNext: (id: string) => invokePlayback(playbackChannels.moveNext, id),
    removeTrack: (id: string) => invokePlayback(playbackChannels.removeTrack, id),
    clearUpcoming: () => invokePlayback(playbackChannels.clearUpcoming),
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
    async enqueueNext(id: string): Promise<void> { await ipcRenderer.invoke(neteaseChannels.enqueueNext, id); },
    onStateChanged(listener: (state: ReturnType<typeof parseNeteaseSnapshot>) => void) {
      if (typeof listener !== 'function') throw new Error('监听器无效');
      const receive = (_event: unknown, value: unknown) => listener(parseNeteaseSnapshot(value));
      ipcRenderer.on(neteaseChannels.stateChanged, receive);
      return () => { ipcRenderer.removeListener(neteaseChannels.stateChanged, receive); };
    },
  }),
  kugou: Object.freeze({
    getState: () => invokeKugou(kugouChannels.getState),
    startLogin: () => invokeKugou(kugouChannels.startLogin),
    cancelLogin: () => invokeKugou(kugouChannels.cancelLogin),
    logout: () => invokeKugou(kugouChannels.logout),
    loadPlaylists: () => invokeKugou(kugouChannels.loadPlaylists),
    loadPlaylist: (id: string, offset: number) => invokeKugou(kugouChannels.loadPlaylist, id, offset),
    async playTrack(id: string): Promise<void> { await ipcRenderer.invoke(kugouChannels.playTrack, id); },
    async enqueueNext(id: string): Promise<void> { await ipcRenderer.invoke(kugouChannels.enqueueNext, id); },
    onStateChanged(listener: (state: ReturnType<typeof parseKugouSnapshot>) => void) {
      if (typeof listener !== 'function') throw new Error('监听器无效');
      const receive = (_event: unknown, value: unknown) => listener(parseKugouSnapshot(value));
      ipcRenderer.on(kugouChannels.stateChanged, receive);
      return () => { ipcRenderer.removeListener(kugouChannels.stateChanged, receive); };
    },
  }),
  credentials: Object.freeze({
    getStatus: () => invokeCredentials(credentialChannels.getStatus),
    setRemember(value: boolean) {
      if (typeof value !== 'boolean') throw new Error('记住登录参数无效');
      return invokeCredentials(credentialChannels.setRemember, value);
    },
    clear: () => invokeCredentials(credentialChannels.clear),
    onChanged(listener: (status: ReturnType<typeof parseCredentialStatus>) => void) {
      if (typeof listener !== 'function') throw new Error('监听器无效');
      const receive = (_event: unknown, value: unknown) => listener(parseCredentialStatus(value));
      ipcRenderer.on(credentialChannels.changed, receive);
      return () => { ipcRenderer.removeListener(credentialChannels.changed, receive); };
    },
  }),
});

contextBridge.exposeInMainWorld('starsMusic', api);
