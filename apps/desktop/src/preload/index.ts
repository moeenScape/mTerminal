import {
  terminalChannels as channels,
  type TerminalEvent,
  type TerminalOpenResult,
} from '../shared/terminal.js';
import { failureMessages, type PreferenceSaveResult } from '../shared/failures.js';
import { PREFERENCES_GET, PREFERENCES_SAVE } from '../shared/preferences.js';
import { contextBridge, ipcRenderer } from 'electron';
import { APP_INFO_CHANNEL, type AppInfo, type DesktopApi } from '../shared/app-info.js';

const api: DesktopApi = {
  getShells: () => ipcRenderer.invoke(channels.shells),
  openTerminal: async (id, size) => {
    const result: TerminalOpenResult = await ipcRenderer.invoke(channels.open, id, size);
    if (!result.ok) throw new Error(failureMessages[result.code]);
  },
  writeTerminal: (id, data) => ipcRenderer.send(channels.write, id, data),
  resizeTerminal: (id, size) => ipcRenderer.send(channels.resize, id, size),
  ackTerminal: (id, count) => ipcRenderer.send(channels.ack, id, count),
  closeTerminal: (id) => ipcRenderer.send(channels.close, id),
  onTerminalEvent: (listener) => {
    const receive = (_event: unknown, value: TerminalEvent) => listener(value);
    ipcRenderer.on(channels.event, receive);
    return () => {
      ipcRenderer.removeListener(channels.event, receive);
    };
  },
  getPreferences: () => ipcRenderer.invoke(PREFERENCES_GET),
  savePreferences: async (preferences) => {
    const result: PreferenceSaveResult = await ipcRenderer.invoke(PREFERENCES_SAVE, preferences);
    if (!result.ok) throw new Error(failureMessages[result.code]);
    return result.preferences;
  },
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(APP_INFO_CHANNEL),
};

contextBridge.exposeInMainWorld('mterminal', api);
