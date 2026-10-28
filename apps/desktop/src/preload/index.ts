import { PREFERENCES_GET, PREFERENCES_SAVE } from '../shared/preferences.js';
import { contextBridge, ipcRenderer } from 'electron';
import { APP_INFO_CHANNEL, type AppInfo, type DesktopApi } from '../shared/app-info.js';

const api: DesktopApi = {
  getPreferences: () => ipcRenderer.invoke(PREFERENCES_GET),
  savePreferences: (preferences) => ipcRenderer.invoke(PREFERENCES_SAVE, preferences),
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(APP_INFO_CHANNEL),
};

contextBridge.exposeInMainWorld('mterminal', api);
