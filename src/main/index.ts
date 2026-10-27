import type { CredentialProvider } from '../../packages/contracts/src/credentials';
import { CredentialStoreClient } from './credential-store-client';
import { LocalKeyCipher } from './local-key-cipher';
import { migrateLegacyCredentials } from './credential-migration';
import { presentationChannels } from '../../packages/contracts/src/presentation';
import { PresentationController } from '../../packages/playback/src/presentation';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, session } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { desktopChannels, type AppInfo } from '../../packages/contracts/src/desktop';
import { assertTrustedInvoke, assertTrustedSource, getDevelopmentUrl } from './ipc-policy';
import { parsePlaybackArgument, playbackChannels } from '../../packages/contracts/src/playback';
import { appError } from '../../packages/contracts/src/errors';
import { audioExtensions, MusicPlayer } from '../../packages/playback/src/player';
import { credentialChannels, parseCredentialArguments } from '../../packages/contracts/src/credentials';
import { CredentialVault } from './credential-vault';
import { SafeStorageCipher } from './safe-storage-cipher';
import { KugouClient } from './kugou-client';
import { kugouChannels, parseKugouArguments } from '../../packages/contracts/src/kugou';
import { NeteaseClient } from './netease-client';
import { neteaseChannels, parseNeteaseArguments } from '../../packages/contracts/src/netease';
import { appearanceChannels, parseAppearanceArguments } from '../../packages/contracts/src/appearance';
import { AppearanceStore } from './appearance-store';

app.setName('StarsMusic');
app.enableSandbox();

const rendererFile = fileURLToPath(new URL('../renderer/index.html', import.meta.url));
const developmentUrl = app.isPackaged ? undefined : getDevelopmentUrl(process.env.ELECTRON_RENDERER_URL);
const documentUrl = developmentUrl ?? pathToFileURL(rendererFile).href;
let mainWindow: BrowserWindow | null = null;
const player = new MusicPlayer();
const netease = new NeteaseClient(fileURLToPath(new URL('./netease-worker.js', import.meta.url)));
const kugou = new KugouClient(fileURLToPath(new URL('./kugou-worker.js', import.meta.url)));
const presentation = new PresentationController(async (track, signal) => {
  if (!track.sourceId || !track.provider || track.provider === 'local') return { lyrics: [] };
  const client = track.provider === 'netease' ? netease : kugou;
  return client.getPresentation(track.sourceId, client.snapshot().generation, signal);
});
let vault: CredentialVault;
let selectionGeneration = 0;
let quitting = false;
let appearance: AppearanceStore;

function windowBackground(): string {
  const preference = appearance?.getPreference() ?? 'system';
  return (preference === 'light' || (preference === 'system' && !nativeTheme.shouldUseDarkColors))
    ? '#f3f5f8' : '#111219';
}

function createWindow(): void {
  const window = new BrowserWindow({
    title: 'StarsMusic',
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: windowBackground(),
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

function broadcastCredentials(): void {
  if (!vault) return;
  void vault.status().then((status) => {
    const contents = mainWindow?.webContents;
    if (contents && !contents.isDestroyed()) contents.send(credentialChannels.changed, status);
  }).catch(() => undefined);
}

async function saveCurrentCredentials(provider: CredentialProvider): Promise<void> {
  const status = await vault.status();
  if (!status.available || !status.rememberedProviders.includes(provider)) return;
  const client = provider === 'netease' ? netease : kugou;
  const state = client.snapshot();
  if (state.status !== 'connected') return;
  try {
    const bundle = await client.exportCredentials();
    const current = client.snapshot();
    if (bundle && current.status === 'connected' && current.generation === state.generation && current.account?.id === bundle.accountId) await vault.save(bundle);
  } catch { /* 状态面板显示保存错误。 */ }
}

async function restoreSavedCredentials(): Promise<void> {
  if (!vault) return;
  const status = await vault.status();
  if (!status.remembered || !status.available || status.locked) return;
  try {
    const bundle = await vault.load('netease');
    if (bundle?.provider === 'netease') {
      const snapshot = await netease.restoreCredentials(bundle);
      if (snapshot.status === 'expired') await vault.remove('netease');
    }
  } catch { /* 保留密文，界面显示锁定/不可用 */ }
  try {
    const bundle = await vault.load('kugou');
    if (bundle?.provider === 'kugou') {
      const snapshot = await kugou.restoreCredentials(bundle);
      if (snapshot.status === 'expired') await vault.remove('kugou');
    }
  } catch { /* 保留密文，界面显示锁定/不可用 */ }
  broadcastCredentials();
}

void app.whenReady().then(async () => {
  const uiSession = session.fromPartition('starsmusic-ui');
  uiSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  uiSession.setPermissionCheckHandler(() => false);
  uiSession.on('will-download', (event) => event.preventDefault());
  Menu.setApplicationMenu(null);
  const profile = app.getPath('userData');
  appearance = new AppearanceStore(path.join(profile, 'appearance.json'));
  await appearance.initialize();
  nativeTheme.on('updated', () => mainWindow?.setBackgroundColor(windowBackground()));
  for (const channel of Object.values(appearanceChannels)) {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      const contents = mainWindow?.webContents;
      assertTrustedSource(event, contents, contents?.mainFrame, documentUrl);
      const preference = parseAppearanceArguments(channel, args);
      if (!preference) return appearance.getPreference();
      try {
        const saved = await appearance.setPreference(preference);
        mainWindow?.setBackgroundColor(windowBackground());
        return saved;
      }
      catch { throw new Error('外观偏好保存失败，请重试。'); }
    });
  }
  const credentialStore = new CredentialStoreClient(fileURLToPath(new URL('./credential-store-worker.js', import.meta.url)), path.join(profile, 'credentials.sqlite'));
  const credentialCipher = new LocalKeyCipher(path.join(profile, 'keys', 'login.key'), async () => Object.keys((await credentialStore.read())?.entries ?? {}).length > 0);
  try { await migrateLegacyCredentials(credentialStore, credentialCipher, new SafeStorageCipher(), path.join(profile, 'credentials.json')); }
  catch { /* 旧加密文件保留，不能导入时由用户重新扫码。 */ }
  vault = new CredentialVault(credentialStore, credentialCipher);
  netease.subscribeCredentials((bundle) => {
    const current = netease.snapshot();
    if (quitting || current.status !== 'connected' || current.account?.id !== bundle.accountId) return;
    void vault.save(bundle).then((saved) => { if (saved) broadcastCredentials(); }).catch(() => broadcastCredentials());
  });
  kugou.subscribeCredentials((bundle) => {
    const current = kugou.snapshot();
    if (quitting || current.status !== 'connected' || current.account?.id !== bundle.accountId) return;
    void vault.save(bundle).then((saved) => { if (saved) broadcastCredentials(); }).catch(() => broadcastCredentials());
  });

  ipcMain.handle(desktopChannels.getAppInfo, (event, ...args: unknown[]): AppInfo => {
    const contents = mainWindow?.webContents;
    assertTrustedInvoke(event, contents, contents?.mainFrame, documentUrl, args);
    return {
      name: app.getName(), version: app.getVersion(), platform: process.platform,
      arch: process.arch, electron: process.versions.electron,
      chromium: process.versions.chrome, node: process.versions.node,
    };
  });
  ipcMain.handle(presentationChannels.getState, (event, ...args: unknown[]) => {
    const contents = mainWindow?.webContents;
    assertTrustedInvoke(event, contents, contents?.mainFrame, documentUrl, args);
    return presentation.snapshot();
  });
  presentation.subscribe((snapshot) => {
    const contents = mainWindow?.webContents;
    if (contents && !contents.isDestroyed()) contents.send(presentationChannels.changed, snapshot);
  });
  player.subscribe((snapshot) => {
    presentation.select(snapshot);
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
      if (channel === neteaseChannels.playPlaylist) {
        const selection = ++selectionGeneration;
        const state = netease.snapshot();
        if (state.status !== 'connected') throw new Error('请先登录');
        const tracks = await netease.preparePlaylist(argument.id!, state.generation);
        if (quitting || selection !== selectionGeneration || netease.snapshot().generation !== state.generation) throw new Error('播放操作已过期');
        await player.openRemoteList('netease', tracks.map(track => ({ title: track.name, sourceId: track.id, artist: track.artists.join('、'), resolve: (signal: AbortSignal) => netease.resolveTrack(track.id, state.generation, signal) })));
        return;
      }
      if (channel === neteaseChannels.playTrack || channel === neteaseChannels.enqueueNext) {
        if (channel === neteaseChannels.playTrack) selectionGeneration++;
        const state = netease.snapshot();
        const track = state.tracks.find((track) => track.id === argument.id)
          ?? state.catalog.tracks.find((track) => track.id === argument.id);
        if (state.status !== 'connected' || !track) throw new Error('曲目尚未登记');
        const resolve = (signal: AbortSignal) => netease.resolveTrack(track.id, state.generation, signal);
        if (channel === neteaseChannels.enqueueNext) {
          player.enqueueRemoteNext('netease', track.name, resolve, track.artists.join('、'), track.id);
        } else {
          await player.openRemote('netease', track.name, resolve, track.artists.join('、'), track.id);
        }
        return;
      }
      if (channel === neteaseChannels.startLogin) {
        await vault.remove('netease').catch(() => undefined); broadcastCredentials();
        return netease.command('startLogin');
      }
      if (channel === neteaseChannels.cancelLogin) {
        const pending = netease.command('cancelLogin');
        await vault.remove('netease').catch(() => undefined); broadcastCredentials();
        return pending;
      }
      if (channel === neteaseChannels.logout) {
        const removal = vault.remove('netease');
        const pending = netease.command('logout');
        await player.clearRemote('netease');
        const snapshot = await pending;
        await removal.catch(() => undefined);
        broadcastCredentials();
        return snapshot;
      }
      if (channel === neteaseChannels.getArtwork) return netease.getArtwork(argument.artwork!);
      if (channel === neteaseChannels.refreshMembership) return netease.command('refreshMembership');
      if (channel === neteaseChannels.loadPlaylists) return netease.command('loadPlaylists');
      if (channel === neteaseChannels.browse) return netease.command('browse', { catalog: argument.catalog });
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
      if (channel === kugouChannels.playTrack || channel === kugouChannels.enqueueNext) {
        if (channel === kugouChannels.playTrack) selectionGeneration++;
        const state = kugou.snapshot();
        const track = state.tracks.find((track) => track.id === argument.id);
        if (state.status !== 'connected' || !track) throw new Error('曲目尚未登记');
        const resolve = (signal: AbortSignal) => kugou.resolveTrack(track.id, state.generation, signal);
        if (channel === kugouChannels.enqueueNext) {
          player.enqueueRemoteNext('kugou', track.name, resolve, track.artists.join('、'), track.id);
        } else {
          await player.openRemote('kugou', track.name, resolve, track.artists.join('、'), track.id);
        }
        return;
      }
      if (channel === kugouChannels.startLogin) {
        await vault.remove('kugou').catch(() => undefined); broadcastCredentials();
        return kugou.command('startLogin');
      }
      if (channel === kugouChannels.cancelLogin) {
        const pending = kugou.command('cancelLogin');
        await vault.remove('kugou').catch(() => undefined); broadcastCredentials();
        return pending;
      }
      if (channel === kugouChannels.logout) {
        const removal = vault.remove('kugou');
        const pending = kugou.command('logout');
        await player.clearRemote('kugou');
        const snapshot = await pending;
        await removal.catch(() => undefined);
        broadcastCredentials();
        return snapshot;
      }
      if (channel === kugouChannels.loadPlaylists) return kugou.command('loadPlaylists');
      if (channel === kugouChannels.loadPlaylist) return kugou.command('loadPlaylist', { id: argument.id, offset: argument.offset });
      return kugou.command('getState');
    });
  }
  for (const channel of Object.values(credentialChannels)) {
    if (channel === credentialChannels.changed) continue;
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      const contents = mainWindow?.webContents;
      assertTrustedSource(event, contents, contents?.mainFrame, documentUrl);
      const choice = parseCredentialArguments(channel, args);
      if (quitting) return vault.status();
      if (channel === credentialChannels.getStatus) return vault.status();
      if (channel === credentialChannels.clear) {
        const status = await vault.clear();
        broadcastCredentials();
        return status;
      }
      try {
        if (!choice) throw new Error('记住登录参数无效');
        await vault.setRemember(choice.provider, choice.remember);
        if (choice.remember) await saveCurrentCredentials(choice.provider);
      } catch { /* 状态里包含不可用/锁定/保存失败原因。 */ }
      const status = await vault.status();
      broadcastCredentials();
      return status;
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
      if (channel === playbackChannels.moveNext) return player.moveNext(argument as string);
      if (channel === playbackChannels.removeTrack) return player.removeTrack(argument as string);
      if (channel === playbackChannels.clearUpcoming) return player.clearUpcoming();
      if (channel === playbackChannels.pause) return player.pause();
      if (channel === playbackChannels.resume) return player.resume();
      if (channel === playbackChannels.stop) { selectionGeneration++; return player.stop(); }
      if (channel === playbackChannels.seek) return player.seek(argument as number);
      if (channel === playbackChannels.setVolume) return player.setVolume(argument as number);
      return player.snapshot();
    });
  }
  createWindow();
  void restoreSavedCredentials();
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
  presentation.dispose();
  selectionGeneration++;
  void Promise.allSettled([netease.dispose(), kugou.dispose(), player.dispose(), vault?.close()]).then(() => app.quit());
});
app.on('will-quit', () => {
  ipcMain.removeHandler(desktopChannels.getAppInfo);
  ipcMain.removeHandler(presentationChannels.getState);
  for (const channel of Object.values(credentialChannels)) {
    if (channel !== credentialChannels.changed) ipcMain.removeHandler(channel);
  }
  for (const channel of Object.values(playbackChannels)) ipcMain.removeHandler(channel);
  for (const channel of Object.values(neteaseChannels)) ipcMain.removeHandler(channel);
  for (const channel of Object.values(kugouChannels)) ipcMain.removeHandler(channel);
});
