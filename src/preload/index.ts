import { contextBridge, ipcRenderer } from 'electron';
import { desktopChannels, parseAppInfo, type DesktopApi } from '../../packages/contracts/src/desktop';

const api: DesktopApi = Object.freeze({
  async getAppInfo() {
    const response: unknown = await ipcRenderer.invoke(desktopChannels.getAppInfo);
    return parseAppInfo(response);
  },
});

contextBridge.exposeInMainWorld('starsMusic', api);
