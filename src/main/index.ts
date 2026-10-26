import { app, BrowserWindow, dialog, ipcMain, Menu, session } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { desktopChannels, type AppInfo } from '../../packages/contracts/src/desktop';
import { assertTrustedInvoke, assertTrustedSource, getDevelopmentUrl } from './ipc-policy';
import { parsePlaybackArgument, playbackChannels } from '../../packages/contracts/src/playback';
import { appError } from '../../packages/contracts/src/errors';
import { audioExtensions, MusicPlayer } from '../../packages/playback/src/player';
import { KugouClient } from './kugou-client';
import { kugouChannels, parseKugouArguments } from '../../packages/contracts/src/kugou';
import { NeteaseClient } from './netease-client';
import { neteaseChannels, parseNeteaseArguments } from '../../packages/contracts/src/netease';

app.setName('StarsMusic');
app.enableSandbox();

const rendererFile = fileURLToPath(new URL('../renderer/index.html', import.meta.url));
const developmentUrl = app.isPackaged ? undefined : getDevelopmentUrl(process.env.ELECTRON_RENDERER_URL);
const documentUrl = developmentUrl ?? pathToFileURL(rendererFile).href;
let mainWindow: BrowserWindow | null = null;
const player = new MusicPlayer();
const netease = new NeteaseClient(fileURLToPath(new URL('./netease-worker.js', import.meta.url)));
const kugou = new KugouClient(fileURLToPath(new URL('./kugou-worker.js', import.meta.url)));
let selectionGeneration = 0;
let quitting = false;

function createWindow(): void {
  const window = new BrowserWindow({
    title: 'StarsMusic',
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#15161c',
    webPreferences: {
      preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)),
      partition: 'starsmusic-ui',
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      webviewTag: false,
      allowRunningInsecureContent: false,
    },
  });
  mainWindow = window;
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-frame-navigate', (event) => event.preventDefault());
  window.webContents.on('will-redirect', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.once('ready-to-show', () => window.show());
  window.once('closed', () => { if (mainWindow === window) mainWindow = null; });
  const load = developmentUrl ? window.loadURL(developmentUrl) : window.loadFile(rendererFile);
  void load.catch(() => {
    console.error('StarsMusic 页面加载失败');
    app.exit(1);
  });
}

void app.whenReady().then(() => {
  const uiSession = session.fromPartition('starsmusic-ui');
  uiSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  uiSession.setPermissionCheckHandler(() => false);
  uiSession.on('will-download', (event) => event.preventDefault());
  Menu.setApplicationMenu(null);

  ipcMain.handle(desktopChannels.getAppInfo, (event, ...args: unknown[]): AppInfo => {
    const contents = mainWindow?.webContents;
    assertTrustedInvoke(event, contents, contents?.mainFrame, documentUrl, args);
    return {
      name: app.getName(), version: app.getVersion(), platform: process.platform,
      arch: process.arch, electron: process.versions.electron,
      chromium: process.versions.chrome, node: process.versions.node,
    };
  });
  player.subscribe((snapshot) => {
    const contents = mainWindow?.webContents;
    if (contents && !contents.isDestroyed()) contents.send(playbackChannels.stateChanged, snapshot);
  });
  netease.subscribe((snapshot) => {
    if (snapshot.status !== 'connected') void player.clearRemote('netease');
    const contents = mainWindow?.webContents;
    if (contents && !contents.isDestroyed()) contents.send(neteaseChannels.stateChanged, snapshot);
  });
  for (const channel of Object.values(neteaseChannels)) {
    if (channel === neteaseChannels.stateChanged) continue;
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      const contents = mainWindow?.webContents;
      assertTrustedSource(event, contents, contents?.mainFrame, documentUrl);
      const argument = parseNeteaseArguments(channel, args);
      if (quitting) return netease.snapshot();
      if (channel === neteaseChannels.playTrack) {
        selectionGeneration++;
        const state = netease.snapshot();
        const track = state.tracks.find((track) => track.id === argument.id);
        if (state.status !== 'connected' || !track) throw new Error('曲目尚未登记');
        await player.openRemote('netease', `${track.name} / ${track.artists.join('、')}`, (signal) => netease.resolveTrack(track.id, state.generation, signal));
        return;
      }
      if (channel === neteaseChannels.startLogin) return netease.command('startLogin');
      if (channel === neteaseChannels.cancelLogin) return netease.command('cancelLogin');
      if (channel === neteaseChannels.logout) {
        const pending = netease.command('logout');
        await player.clearRemote('netease');
        return pending;
      }
      if (channel === neteaseChannels.loadPlaylists) return netease.command('loadPlaylists');
      if (channel === neteaseChannels.loadPlaylist) return netease.command('loadPlaylist', { id: argument.id, offset: argument.offset });
      return netease.command('getState');
    });
  }
  kugou.subscribe((snapshot) => {
    if (snapshot.status !== 'connected') void player.clearRemote('kugou');
    const contents = mainWindow?.webContents;
    if (contents && !contents.isDestroyed()) contents.send(kugouChannels.stateChanged, snapshot);
  });
  for (const channel of Object.values(kugouChannels)) {
    if (channel === kugouChannels.stateChanged) continue;
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      const contents = mainWindow?.webContents;
      assertTrustedSource(event, contents, contents?.mainFrame, documentUrl);
      const argument = parseKugouArguments(channel, args);
      if (quitting) return kugou.snapshot();
      if (channel === kugouChannels.playTrack) {
        selectionGeneration++;
        const state = kugou.snapshot();
        const track = state.tracks.find((track) => track.id === argument.id);
        if (state.status !== 'connected' || !track) throw new Error('曲目尚未登记');
        await player.openRemote('kugou', `${track.name} / ${track.artists.join('、')}`, (signal) => kugou.resolveTrack(track.id, state.generation, signal));
        return;
      }
      if (channel === kugouChannels.startLogin) return kugou.command('startLogin');
      if (channel === kugouChannels.cancelLogin) return kugou.command('cancelLogin');
      if (channel === kugouChannels.logout) {
        const pending = kugou.command('logout');
        await player.clearRemote('kugou');
        return pending;
      }
      if (channel === kugouChannels.loadPlaylists) return kugou.command('loadPlaylists');
      if (channel === kugouChannels.loadPlaylist) return kugou.command('loadPlaylist', { id: argument.id, offset: argument.offset });
      return kugou.command('getState');
    });
  }
  for (const channel of Object.values(playbackChannels)) {
    if (channel === playbackChannels.stateChanged) continue;
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      const window = mainWindow;
      const contents = window?.webContents;
      assertTrustedSource(event, contents, contents?.mainFrame, documentUrl);
      const argument = parsePlaybackArgument(channel, args);
      if (quitting) return player.snapshot();
      if (channel === playbackChannels.openFiles) {
        const generation = ++selectionGeneration;
        try {
          const result = await dialog.showOpenDialog(window!, {
            title: '选择本地音频', properties: ['openFile', 'multiSelections'],
            filters: [{ name: '音频文件', extensions: audioExtensions }],
          });
          if (quitting || generation !== selectionGeneration || mainWindow !== window || result.canceled) return player.snapshot();
          return player.openFiles(result.filePaths);
        } catch {
          if (quitting || generation !== selectionGeneration || mainWindow !== window) return player.snapshot();
          return player.reportError(appError('file-unavailable'));
        }
      }
      if (channel === playbackChannels.playTrack) { selectionGeneration++; return player.playTrack(argument as string); }
      if (channel === playbackChannels.pause) return player.pause();
      if (channel === playbackChannels.resume) return player.resume();
      if (channel === playbackChannels.stop) { selectionGeneration++; return player.stop(); }
      if (channel === playbackChannels.seek) return player.seek(argument as number);
      if (channel === playbackChannels.setVolume) return player.setVolume(argument as number);
      return player.snapshot();
    });
  }
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch(() => {
  console.error('StarsMusic 初始化失败');
  app.exit(1);
});

// 当前没有托盘与后台播放，关闭窗口直接退出，避免留下不可恢复的后台进程。
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  selectionGeneration++;
  void Promise.allSettled([netease.dispose(), kugou.dispose(), player.dispose()]).then(() => app.quit());
});
app.on('will-quit', () => {
  ipcMain.removeHandler(desktopChannels.getAppInfo);
  for (const channel of Object.values(playbackChannels)) ipcMain.removeHandler(channel);
  for (const channel of Object.values(neteaseChannels)) ipcMain.removeHandler(channel);
  for (const channel of Object.values(kugouChannels)) ipcMain.removeHandler(channel);
});
