import type { BroadcastApi } from './broadcast.js';
import type { BatchApi } from './batch.js';
import type { SnippetsApi } from './snippets.js';
import type { TemplatesApi } from './workspace-templates.js';
import type { HostsApi } from './hosts.js';
import type { TerminalApi } from './terminal.js';
import type { VaultApi } from './vault.js';
import type { BackupApi } from './backup.js';
import type { HistoryApi } from './history.js';
import type { FilesApi } from './files.js';
import type { TransfersApi } from './transfers.js';
import type { RemoteEditApi } from './remote-edit.js';
export const APP_INFO_CHANNEL = 'app:get-info';

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
}

export interface DesktopApi
  extends
    TerminalApi,
    HostsApi,
    VaultApi,
    BackupApi,
    HistoryApi,
    FilesApi,
    TransfersApi,
    RemoteEditApi,
    TemplatesApi,
    SnippetsApi,
    BatchApi,
    BroadcastApi {
  readClipboardText: () => Promise<string>;
  writeClipboardText: (text: string) => Promise<void>;
  getAppInfo: () => Promise<AppInfo>;
  getPreferences: () => Promise<import('./preferences.js').Preferences>;
  savePreferences: (
    preferences: import('./preferences.js').Preferences,
  ) => Promise<import('./preferences.js').Preferences>;
}
