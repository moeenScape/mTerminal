import type { TerminalApi } from './terminal.js';
export const APP_INFO_CHANNEL = 'app:get-info';

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
}

export interface DesktopApi extends TerminalApi {
  readClipboardText: () => Promise<string>;
  writeClipboardText: (text: string) => Promise<void>;
  getAppInfo: () => Promise<AppInfo>;
  getPreferences: () => Promise<import('./preferences.js').Preferences>;
  savePreferences: (
    preferences: import('./preferences.js').Preferences,
  ) => Promise<import('./preferences.js').Preferences>;
}
