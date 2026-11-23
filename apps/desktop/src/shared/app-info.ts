import type { SessionLogsApi } from './session-logs.js';
import type { BroadcastApi } from './broadcast.js';
import type { BatchApi } from './batch.js';
import type { ForwardsApi } from './port-forwarding.js';
import type { ProxiesApi } from './proxies.js';
import type { AgentApi } from './agent.js';
import type { SerialApi } from './serial.js';
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
import type { AccountApi } from './accounts.js';
import type { WorkspaceSyncApi } from './workspace-sync.js';
import type { SyncPreferencesApi } from './sync-preferences.js';
import type { SharedVaultApi, SharedVaultSettings } from './organization-vault.js';
import type { SharedLogsApi } from './shared-logs.js';
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
    ForwardsApi,
    ProxiesApi,
    AgentApi,
    SerialApi,
    BroadcastApi,
    SessionLogsApi,
    AccountApi,
    WorkspaceSyncApi,
    SyncPreferencesApi,
    SharedVaultApi,
    SharedLogsApi {
  readClipboardText: () => Promise<string>;
  /** `primary` also fills the Linux middle-click selection. */
  writeClipboardText: (text: string, options?: { primary?: boolean }) => Promise<void>;
  getAppInfo: () => Promise<AppInfo>;
  onPortablePreferencesChanged: (listener: (settings: SharedVaultSettings) => void) => () => void;
  getPreferences: () => Promise<import('./preferences.js').Preferences>;
  savePreferences: (
    preferences: import('./preferences.js').Preferences,
  ) => Promise<import('./preferences.js').Preferences>;
}
