import { ipcMain, type BrowserWindow } from 'electron';
import { windowChannels, parseWindowCommand } from '../../packages/contracts/src/window';
import { controlWindow, windowSnapshot } from '../../packages/desktop/src/window-controls';
import { assertTrustedInvoke } from './ipc-policy';

export function registerWindowControls(getWindow: () => BrowserWindow | null, documentUrl: string): () => void {
  const channels = Object.values(windowChannels).filter(channel => channel !== windowChannels.changed);
  for (const channel of channels) ipcMain.handle(channel, (event, ...args: unknown[]) => {
    const window = getWindow(); const contents = window?.webContents;
    assertTrustedInvoke(event, contents, contents?.mainFrame, documentUrl, args);
    if (!window || window.isDestroyed()) throw new Error('主窗口不可用');
    const command = parseWindowCommand(channel, args);
    if (command === 'close') { window.close(); return; }
    controlWindow(window, command);
    return windowSnapshot(window, process.platform);
  });
  return () => { for (const channel of channels) ipcMain.removeHandler(channel); };
}

export function observeWindowControls(window: BrowserWindow): void {
  const publish = () => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(windowChannels.changed, windowSnapshot(window, process.platform));
  };
  window.on('maximize', publish);
  window.on('unmaximize', publish);
  window.on('enter-full-screen', publish);
  window.on('leave-full-screen', publish);
  window.on('focus', publish);
  window.on('blur', publish);
  window.on('minimize', publish);
  window.on('restore', publish);
}
