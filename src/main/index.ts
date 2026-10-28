import { DesktopController } from '../../packages/desktop/src/controller';
import { DesktopSettings } from '../../packages/desktop/src/settings';
import { electronDesktopRuntime } from '../../packages/desktop/src/electron-runtime';
import { desktopId } from '../../packages/desktop/src/linux/mpris';
import { systemChannels, parseSystemArguments } from '../../packages/contracts/src/system';
import { PlaybackSession } from './playback-session';
import { PlaybackSessionStoreClient } from './playback-session-client';
import type { StoredRemoteTrack } from '../../packages/contracts/src/playback-session';
import { DomainError } from '../../packages/contracts/src/errors';
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
import { parseLoopMode, parsePlaybackMode, parsePlaybackArgument, playbackChannels } from '../../packages/contracts/src/playback';
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
import { windowChrome } from '../../packages/desktop/src/window-controls';
import { observeWindowControls, registerWindowControls } from './window-controls';

app.setName('StarsMusic');
if (process.platform === 'linux') app.setDesktopName(`${desktopId}.desktop`);
if (process.platform === 'win32') app.setAppUserModelId('org.starsmusic.StarsMusic');
app.enableSandbox();
const ownsInstance = !app.isPackaged || app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();

const rendererFile = fileURLToPath(new URL('../renderer/index.html', import.meta.url));
const developmentUrl = app.isPackaged ? undefined : getDevelopmentUrl(process.env.ELECTRON_RENDERER_URL);
const documentUrl = developmentUrl ?? pathToFileURL(rendererFile).href;
let mainWindow: BrowserWindow | null = null;
const player = new MusicPlayer(app.isPackaged && process.platform === 'win32'
  ? { executable: path.join(process.resourcesPath, 'mpv', 'mpv.exe') } : {});
const netease = new NeteaseClient(fileURLToPath(new URL('./netease-worker.js', import.meta.url)));
const kugou = new KugouClient(fileURLToPath(new URL('./kugou-worker.js', import.meta.url)));
const presentation = new PresentationController(async (track, signal) => {
  if (!track.sourceId || !track.provider || track.provider === 'local') return { lyrics: [] };
  const client = track.provider === 'netease' ? netease : kugou;
  const saved = player.storedTrack(track.id);
  const generation = client.snapshot().generation;
  if (saved && saved.kind !== 'local') await client.ensureRestoredTrack(saved, generation, signal);
  return client.getPresentation(track.sourceId, generation, signal);
});
let desktopIntegration: DesktopController | undefined;
function showMainWindow(): void {
  if (quitting) return;
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (mainWindow?.isMinimized()) mainWindow.restore();
  mainWindow?.show(); mainWindow?.focus();
}
let playbackSession: PlaybackSession | undefined;
async function resolveSavedTrack(track: StoredRemoteTrack, signal: AbortSignal) {
  const client = track.kind === 'netease' ? netease : kugou;
  const state = client.snapshot();
  if (state.status !== 'connected' || state.account?.id !== track.accountId) throw new DomainError('playback-login-required');
  await client.ensureRestoredTrack(track, state.generation, signal);
  return client.resolveTrack(track.sourceId, state.generation, signal);
}
let vault: CredentialVault;
let selectionGeneration = 0;
let quitting = false;
let appearance: AppearanceStore;
let disposeWindowControls: (() => void) | undefined;

function windowBackground(): string {
  const preference = appearance?.getPreference() ?? 'system';
  return (preference === 'light' || (preference === 'system' && !nativeTheme.shouldUseDarkColors))
    ? '#f3f5f8' : '#111219';
}

function createWindow(): void {
  const window = new BrowserWindow({
    ...windowChrome(process.platform),
    title: 'StarsMusic',
    ...(app.isPackaged && process.platform === 'linux' ? { icon: path.join(process.resourcesPath, 'app/icon.png') } : {}),
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
  observeWindowControls(window);
  window.webContents.on('before-input-event', (event, input) => { if (desktopIntegration?.handleInput(input)) event.preventDefault(); });
  window.on('close', (event) => {
    if (!quitting && desktopIntegration?.shouldHideOnClose()) { event.preventDefault(); window.hide(); }
  });
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
  if (!ownsInstance) return;
  const uiSession = session.fromPartition('starsmusic-ui');
  uiSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  uiSession.setPermissionCheckHandler(() => false);
  uiSession.on('will-download', (event) => event.preventDefault());
  Menu.setApplicationMenu(null);
  disposeWindowControls = registerWindowControls(() => mainWindow, documentUrl);
  const profile = app.getPath('userData');
  appearance = new AppearanceStore(path.join(profile, 'appearance.json'));
  await appearance.initialize();
  playbackSession = new PlaybackSession(player, new PlaybackSessionStoreClient(fileURLToPath(new URL('./playback-session-worker.js', import.meta.url)), path.join(profile, 'playback.sqlite')));
  await playbackSession.initialize(resolveSavedTrack);
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
    if (snapshot.status !== 'connected') void player.clearRemote('netease', true);
    else if (snapshot.account) void player.bindRestoredProvider('netease', snapshot.account.id);
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
        await player.openRemoteList('netease', tracks.map(track => ({ title: track.name, sourceId: track.id, artist: track.artists.join('、'), accountId: state.account!.id, durationMs: track.durationMs, resolve: (signal: AbortSignal) => netease.resolveTrack(track.id, state.generation, signal) })));
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
          player.enqueueRemoteNext('netease', track.name, resolve, track.artists.join('、'), track.id, state.account!.id, track.durationMs);
        } else {
          await player.openRemote('netease', track.name, resolve, track.artists.join('、'), track.id, state.account!.id, track.durationMs);
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
      if (channel === neteaseChannels.refreshLibrary) return netease.command('refreshLibrary');
      if (channel === neteaseChannels.updateLibrary) return netease.command('updateLibrary', { mutation: argument.mutation });
      if (channel === neteaseChannels.loadLikes) return netease.command('loadLikes');
      if (channel === neteaseChannels.getArtwork) return netease.getArtwork(argument.artwork!);
      if (channel === neteaseChannels.refreshMembership) return netease.command('refreshMembership');
      if (channel === neteaseChannels.loadPlaylists) return netease.command('loadPlaylists');
      if (channel === neteaseChannels.browse) return netease.command('browse', { catalog: argument.catalog });
      if (channel === neteaseChannels.loadPlaylist) return netease.command('loadPlaylist', { id: argument.id, offset: argument.offset });
      return netease.command('getState');
    });
  }
  kugou.subscribe((snapshot) => {
    if (snapshot.status !== 'connected') void player.clearRemote('kugou', true);
    else if (snapshot.account) void player.bindRestoredProvider('kugou', snapshot.account.id);
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
      if (channel === kugouChannels.refreshMembership) return kugou.command('refreshMembership');
      if (channel === kugouChannels.getArtwork) return kugou.getArtwork(argument.artwork!);
      if (channel === kugouChannels.browse) return kugou.command('browse', { catalog: argument.catalog });
      if (channel === kugouChannels.playPlaylist) {
        const selection = ++selectionGeneration; const state = kugou.snapshot();
        if (state.status !== 'connected') throw new Error('请先登录');
        const tracks = await kugou.preparePlaylist(argument.id!, argument.source!, state.generation);
        if (quitting || selection !== selectionGeneration || kugou.snapshot().generation !== state.generation) throw new Error('播放操作已过期');
        await player.openRemoteList('kugou', tracks.map(track => ({ title: track.name, sourceId: track.id, artist: track.artists.join('、'), accountId: state.account!.id, durationMs: track.durationMs,
          resolve: (signal: AbortSignal) => kugou.resolveTrack(track.id, state.generation, signal) })));
        return;
      }
      if (channel === kugouChannels.playTrack || channel === kugouChannels.enqueueNext) {
        if (channel === kugouChannels.playTrack) selectionGeneration++;
        const state = kugou.snapshot();
        const track = state.tracks.find((track) => track.id === argument.id) ?? state.catalog.tracks.find(track => track.id === argument.id);
        if (state.status !== 'connected' || !track) throw new Error('曲目尚未登记');
        const resolve = (signal: AbortSignal) => kugou.resolveTrack(track.id, state.generation, signal);
        if (channel === kugouChannels.enqueueNext) {
          player.enqueueRemoteNext('kugou', track.name, resolve, track.artists.join('、'), track.id, state.account!.id, track.durationMs);
        } else {
          await player.openRemote('kugou', track.name, resolve, track.artists.join('、'), track.id, state.account!.id, track.durationMs);
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
      if (channel === playbackChannels.next) { selectionGeneration++; return player.next(); }
      if (channel === playbackChannels.previous) { selectionGeneration++; return player.previous(); }
      if (channel === playbackChannels.setLoopMode) return player.setLoopMode(parseLoopMode(argument));
      if (channel === playbackChannels.setShuffle) return player.setShuffle(argument as boolean);
      if (channel === playbackChannels.setMode) return player.setMode(parsePlaybackMode(argument));
      if (channel === playbackChannels.pause) return player.pause();
      if (channel === playbackChannels.resume) return player.resume();
      if (channel === playbackChannels.stop) { selectionGeneration++; return player.stop(); }
      if (channel === playbackChannels.seek) return player.seek(argument as number);
      if (channel === playbackChannels.setMuted) return player.setMuted(argument as boolean);
      if (channel === playbackChannels.setVolume) return player.setVolume(argument as number);
      return player.snapshot();
    });
  }
  desktopIntegration = new DesktopController(player, presentation, electronDesktopRuntime({
    show: showMainWindow, hide: () => mainWindow?.hide(), quit: () => app.quit(),
    isVisible: () => !!mainWindow?.isVisible() && !mainWindow.isMinimized(),
  }), new DesktopSettings(path.join(profile, 'desktop.json')));
  desktopIntegration.subscribe(snapshot => {
    const contents = mainWindow?.webContents;
    if (contents && !contents.isDestroyed()) contents.send(systemChannels.changed, snapshot);
  });
  for (const channel of Object.values(systemChannels)) {
    if (channel === systemChannels.changed) continue;
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      const contents = mainWindow?.webContents;
      assertTrustedSource(event, contents, contents?.mainFrame, documentUrl);
      const argument = parseSystemArguments(channel, args);
      if (quitting) return desktopIntegration!.snapshot();
      if (channel === systemChannels.quit) { setImmediate(() => app.quit()); return; }
      if (channel === systemChannels.refresh) return desktopIntegration!.refresh();
      if (channel === systemChannels.setPreference && argument) return desktopIntegration!.setPreference(argument.key, argument.enabled);
      if (channel === systemChannels.testNotification) return desktopIntegration!.testNotification();
      return desktopIntegration!.snapshot();
    });
  }
  createWindow();
  void desktopIntegration.initialize();
  void restoreSavedCredentials();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch(() => {
  console.error('StarsMusic 初始化失败');
  app.exit(1);
});

// 默认关闭窗口退出；用户明确启用且托盘宿主仍可用时，由窗口 close 钩子隐藏。
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('second-instance', () => showMainWindow());
// Package removal sends SIGTERM: use the normal shutdown path to flush SQLite
// and stop mpv before the uninstaller removes the user's data directory.
process.on('SIGTERM', () => app.quit());
app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  presentation.dispose();
  selectionGeneration++;
  void (async () => {
    try { await desktopIntegration?.dispose(); } catch { /* 桌面服务故障不能阻止播放记录和音频进程清理。 */ }
    try { await playbackSession?.close(); } catch { /* 原记录保留；退出仍清理子进程。 */ }
    await Promise.allSettled([netease.dispose(), kugou.dispose(), player.dispose(), vault?.close()]);
    app.quit();
  })();
});
app.on('will-quit', () => {
  for (const channel of Object.values(systemChannels)) if (channel !== systemChannels.changed) ipcMain.removeHandler(channel);
  ipcMain.removeHandler(desktopChannels.getAppInfo);
  disposeWindowControls?.();
  ipcMain.removeHandler(presentationChannels.getState);
  for (const channel of Object.values(credentialChannels)) {
    if (channel !== credentialChannels.changed) ipcMain.removeHandler(channel);
  }
  for (const channel of Object.values(playbackChannels)) ipcMain.removeHandler(channel);
  for (const channel of Object.values(neteaseChannels)) ipcMain.removeHandler(channel);
  for (const channel of Object.values(kugouChannels)) ipcMain.removeHandler(channel);
});
