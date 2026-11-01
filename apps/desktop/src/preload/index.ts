import type { SshChallenge } from '../shared/ssh.js';
import { hostChannels } from '../shared/hosts.js';
import {
  clipboardChannels,
  type ClipboardReadResult,
  type ClipboardWriteResult,
} from '../shared/clipboard.js';
import {
  terminalChannels as channels,
  type TerminalEvent,
  type TerminalOpenResult,
} from '../shared/terminal.js';
import { failureMessages, type PreferenceSaveResult } from '../shared/failures.js';
import { PREFERENCES_GET, PREFERENCES_SAVE } from '../shared/preferences.js';
import {
  vaultChannels,
  vaultEvents,
  type VaultResponse,
  type VaultState,
} from '../shared/vault.js';
import { contextBridge, ipcRenderer } from 'electron';
import { APP_INFO_CHANNEL, type AppInfo, type DesktopApi } from '../shared/app-info.js';
import { backupChannels } from '../shared/backup.js';
import { historyChannels, historyEvents, type CommandHistoryEntry } from '../shared/history.js';
import {
  FILES_LIST,
  FILES_MUTATE,
  fileErrorMessages,
  type FileListResult,
  type FileMutationResult,
} from '../shared/files.js';

async function historyRequest<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result: VaultResponse<T> = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw new Error(failureMessages[result.code]);
  return result.value;
}

const api: DesktopApi = {
  mutateDirectory: async (request) => {
    const result: FileMutationResult = await ipcRenderer.invoke(FILES_MUTATE, request);
    if (!result.ok) throw new Error(fileErrorMessages[result.code]);
  },
  listDirectory: async (request) => {
    const result: FileListResult = await ipcRenderer.invoke(FILES_LIST, request);
    if (!result.ok) throw new Error(fileErrorMessages[result.code]);
    return result.value;
  },
  onHistoryChanged: (listener) => {
    const receive = () => listener();
    ipcRenderer.on(historyEvents.changed, receive);
    return () => ipcRenderer.removeListener(historyEvents.changed, receive);
  },
  searchHistory: (query, directory, mode) =>
    historyRequest<CommandHistoryEntry[]>(historyChannels.search, query, directory, mode),
  deleteHistory: (id) => historyRequest<void>(historyChannels.delete, id),
  clearHistory: () => historyRequest<void>(historyChannels.clear),
  exportWorkspace: () => ipcRenderer.invoke(backupChannels.export),
  importWorkspace: () => ipcRenderer.invoke(backupChannels.import),
  getVaultState: async () => {
    const result: VaultResponse<VaultState> = await ipcRenderer.invoke(vaultChannels.state);
    if (!result.ok) throw new Error(failureMessages[result.code]);
    return result.value;
  },
  setupVault: async (passphrase) => {
    const result: VaultResponse<undefined> = await ipcRenderer.invoke(
      vaultChannels.setup,
      passphrase,
    );
    if (!result.ok) throw new Error(failureMessages[result.code]);
  },
  unlockVault: async (passphrase) => {
    const result: VaultResponse<undefined> = await ipcRenderer.invoke(
      vaultChannels.unlock,
      passphrase,
    );
    if (!result.ok) throw new Error(failureMessages[result.code]);
  },
  lockVault: async () => {
    const result: VaultResponse<undefined> = await ipcRenderer.invoke(vaultChannels.lock);
    if (!result.ok) throw new Error(failureMessages[result.code]);
  },
  resetVault: async () => {
    const result: VaultResponse<boolean> = await ipcRenderer.invoke(vaultChannels.reset);
    if (!result.ok) throw new Error(failureMessages[result.code]);
    return result.value;
  },
  onVaultLocked: (listener) => {
    const receive = () => listener();
    ipcRenderer.on(vaultEvents.locked, receive);
    return () => ipcRenderer.removeListener(vaultEvents.locked, receive);
  },
  answerSshChallenge: (id, token, answers) =>
    ipcRenderer.send(channels.sshAnswer, id, token, answers),
  onSshChallenge: (listener) => {
    const receive = (_event: unknown, challenge: SshChallenge) => listener(challenge);
    ipcRenderer.on(channels.sshChallenge, receive);
    return () => {
      ipcRenderer.removeListener(channels.sshChallenge, receive);
    };
  },
  openSshTerminal: async (id, size, hostId, credentials) => {
    const result: TerminalOpenResult = await ipcRenderer.invoke(
      channels.ssh,
      id,
      size,
      hostId,
      credentials,
    );
    if (!result.ok) throw new Error(failureMessages[result.code]);
  },
  installSshPublicKey: async (hostId, password) => {
    const result: TerminalOpenResult = await ipcRenderer.invoke(
      channels.installPublicKey,
      hostId,
      password,
    );
    if (!result.ok) throw new Error(failureMessages[result.code]);
  },
  listHostGroups: () => ipcRenderer.invoke(hostChannels.groups),
  saveHostGroup: (group) => ipcRenderer.invoke(hostChannels.saveGroup, group),
  deleteHostGroup: (path) => ipcRenderer.invoke(hostChannels.deleteGroup, path),
  listHosts: () => ipcRenderer.invoke(hostChannels.list),
  saveHost: (host, id) => ipcRenderer.invoke(hostChannels.save, host, id),
  deleteHost: (id) => ipcRenderer.invoke(hostChannels.delete, id),
  listSshIdentities: () => ipcRenderer.invoke(hostChannels.identities),
  saveSshIdentity: (identity, id) => ipcRenderer.invoke(hostChannels.saveIdentity, identity, id),
  deleteSshIdentity: (id) => ipcRenderer.invoke(hostChannels.deleteIdentity, id),
  getSshPasswordStatus: async (identityId) => {
    const result: VaultResponse<{ available: boolean; saved: boolean }> = await ipcRenderer.invoke(
      vaultChannels.status,
      identityId,
    );
    if (!result.ok) throw new Error(failureMessages[result.code]);
    return result.value;
  },
  saveSshPassword: async (identityId, password) => {
    const result: VaultResponse<undefined> = await ipcRenderer.invoke(
      vaultChannels.save,
      identityId,
      password,
    );
    if (!result.ok) throw new Error(failureMessages[result.code]);
  },
  deleteSshPassword: async (identityId) => {
    const result: VaultResponse<undefined> = await ipcRenderer.invoke(
      vaultChannels.delete,
      identityId,
    );
    if (!result.ok) throw new Error(failureMessages[result.code]);
  },
  getSshKeyStatus: async (identityId) => {
    const result: VaultResponse<{ available: boolean; saved: boolean; publicKey?: string }> =
      await ipcRenderer.invoke(vaultChannels.keyStatus, identityId);
    if (!result.ok) throw new Error(failureMessages[result.code]);
    return result.value;
  },
  importSshKey: async (identityId, passphrase) => {
    const result: VaultResponse<string> = await ipcRenderer.invoke(
      vaultChannels.keyImport,
      identityId,
      passphrase,
    );
    if (!result.ok) throw new Error(failureMessages[result.code]);
    return result.value;
  },
  generateSshKey: async (identityId, passphrase) => {
    const result: VaultResponse<string> = await ipcRenderer.invoke(
      vaultChannels.keyGenerate,
      identityId,
      passphrase,
    );
    if (!result.ok) throw new Error(failureMessages[result.code]);
    return result.value;
  },
  deleteSshKey: async (identityId) => {
    const result: VaultResponse<undefined> = await ipcRenderer.invoke(
      vaultChannels.keyDelete,
      identityId,
    );
    if (!result.ok) throw new Error(failureMessages[result.code]);
  },
  readClipboardText: async () => {
    const result: ClipboardReadResult = await ipcRenderer.invoke(clipboardChannels.read);
    if (!result.ok) throw new Error(failureMessages[result.code]);
    return result.text;
  },
  writeClipboardText: async (text) => {
    const result: ClipboardWriteResult = await ipcRenderer.invoke(clipboardChannels.write, text);
    if (!result.ok) throw new Error(failureMessages[result.code]);
  },
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
