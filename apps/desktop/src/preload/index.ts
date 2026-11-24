import {
  sessionLogChannels,
  SESSION_LOGS_CHANGED,
  type SessionLog,
  type SessionLogSummary,
  type LogRecordingState,
} from '../shared/session-logs.js';
import { broadcastChannels, BROADCAST_CHANGED, type BroadcastState } from '../shared/broadcast.js';
import {
  batchChannels,
  BATCH_CHANGED,
  type BatchTarget,
  type BatchPreview,
  type BatchState,
} from '../shared/batch.js';
import {
  forwardChannels,
  FORWARDS_CHANGED,
  forwardErrorMessages,
  type ActiveForward,
  type ForwardError,
  type PortForwardRule,
} from '../shared/port-forwarding.js';
import { AGENT_STATUS, type AgentStatus } from '../shared/agent.js';
import { serialChannels, type SerialPortInfo, type SerialProfile } from '../shared/serial.js';
import { proxyChannels, type ProxySummary, type SavedProxy } from '../shared/proxies.js';
import { snippetChannels, SNIPPETS_CHANGED, type Snippet } from '../shared/snippets.js';
import { templateChannels } from '../shared/workspace-templates.js';
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
import {
  PREFERENCES_GET,
  PREFERENCES_SAVE,
  PORTABLE_PREFERENCES_CHANGED,
} from '../shared/preferences.js';
import {
  vaultChannels,
  vaultEvents,
  type VaultResponse,
  type VaultState,
  type SshPasswordStatus,
} from '../shared/vault.js';
import { contextBridge, ipcRenderer } from 'electron';
import { APP_INFO_CHANNEL, type AppInfo, type DesktopApi } from '../shared/app-info.js';
import { backupChannels } from '../shared/backup.js';
import {
  ACCOUNT_REQUEST,
  ADMINISTRATIVE_EVENTS_REQUEST,
  type AdministrativeReply,
  DEVICE_DIRECTORY_REQUEST,
  type AccountResult,
  type DeviceDirectoryResult,
  ORGANIZATION_REQUEST,
  type OrganizationResult,
} from '../shared/accounts.js';
import {
  ORGANIZATION_VAULT_REQUEST,
  VAULT_ACCESS_REQUEST,
  type VaultAccessReply,
  sharedVaultErrors,
  type SharedVaultReply,
  type SharedVaultSettings,
} from '../shared/organization-vault.js';
import { SYNC_PREFERENCES_REQUEST, type SyncPreferenceReply } from '../shared/sync-preferences.js';
import {
  SYNC_QUEUE_CHANGED,
  SYNC_WORKSPACE_REQUEST,
  type WorkspaceSyncReply,
} from '../shared/workspace-sync.js';
import { accountErrors } from '../../../../packages/shared/accounts.ts';
import { historyChannels, historyEvents, type CommandHistoryEntry } from '../shared/history.js';
import {
  transferChannels,
  TRANSFERS_CHANGED,
  type TransferResponse,
  type TransferJob,
  type TransferRecoveryRecord,
  type PartialCleanupPreview,
  type TransferResumePreview,
} from '../shared/transfers.js';
import {
  remoteEditChannels,
  REMOTE_EDIT_CHANGED,
  type RemoteEditState,
} from '../shared/remote-edit.js';
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
async function forwardRequest<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result: { ok: true; value: T } | { ok: false; code: ForwardError } =
    await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw new Error(forwardErrorMessages[result.code]);
  return result.value;
}
async function proxyRequest<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result: { ok: true; value: T } | { ok: false; message: string } = await ipcRenderer.invoke(
    channel,
    ...args,
  );
  if (!result.ok) throw new Error(result.message);
  return result.value;
}
async function transferRequest<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result: TransferResponse<T> = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw new Error(fileErrorMessages[result.code]);
  return result.value;
}

import { SHARED_LOGS_REQUEST, type SharedLogsReply } from '../shared/shared-logs.js';

import {
  LIVE_CHANGED,
  LIVE_REQUEST,
  type LiveReply,
  type LiveState,
} from '../shared/live-share.js';

const api: DesktopApi = {
  liveTerminal: async (action) => {
    const reply: LiveReply = await ipcRenderer.invoke(LIVE_REQUEST, action);
    if (!reply.ok) throw new Error(accountErrors[reply.code]);
    return reply.view;
  },
  onLiveTerminalChanged: (listener) => {
    const receive = (_event: Electron.IpcRendererEvent, state: LiveState) => listener(state);
    ipcRenderer.on(LIVE_CHANGED, receive);
    return () => {
      ipcRenderer.removeListener(LIVE_CHANGED, receive);
    };
  },
  sharedLogs: async (action) => {
    const reply: SharedLogsReply = await ipcRenderer.invoke(SHARED_LOGS_REQUEST, action);
    if (!reply.ok) throw new Error(sharedVaultErrors[reply.code] ?? accountErrors[reply.code]);
    return reply.view;
  },
  organizationEvents: async (query) => {
    const reply: AdministrativeReply = await ipcRenderer.invoke(
      ADMINISTRATIVE_EVENTS_REQUEST,
      query,
    );
    if (!reply.ok) throw new Error(accountErrors[reply.code]);
    return reply.page;
  },
  organizationVaultAccess: async (action) => {
    const reply: VaultAccessReply = await ipcRenderer.invoke(VAULT_ACCESS_REQUEST, action);
    if (!reply.ok) throw new Error(accountErrors[reply.code]);
    return reply.view;
  },
  organizationVault: async (action) => {
    const reply: SharedVaultReply = await ipcRenderer.invoke(ORGANIZATION_VAULT_REQUEST, action);
    if (!reply.ok) throw new Error(sharedVaultErrors[reply.code] ?? accountErrors[reply.code]);
    return reply.view;
  },
  onPortablePreferencesChanged: (listener) => {
    const notify = (_event: Electron.IpcRendererEvent, settings: SharedVaultSettings) =>
      listener(settings);
    ipcRenderer.on(PORTABLE_PREFERENCES_CHANGED, notify);
    return () => {
      ipcRenderer.removeListener(PORTABLE_PREFERENCES_CHANGED, notify);
    };
  },
  syncPreferences: async (action) => {
    const result: SyncPreferenceReply = await ipcRenderer.invoke(SYNC_PREFERENCES_REQUEST, action);
    if (!result.ok) throw new Error(accountErrors[result.code]);
    return result.result;
  },
  syncWorkspace: async (action) => {
    const reply: WorkspaceSyncReply = await ipcRenderer.invoke(SYNC_WORKSPACE_REQUEST, action);
    if (!reply.ok) throw new Error(accountErrors[reply.code]);
    return reply.result;
  },
  onWorkspaceSyncQueueChanged: (listener) => {
    const notify = () => listener();
    ipcRenderer.on(SYNC_QUEUE_CHANGED, notify);
    return () => {
      ipcRenderer.removeListener(SYNC_QUEUE_CHANGED, notify);
    };
  },
  organizations: async (action) => {
    const result: OrganizationResult = await ipcRenderer.invoke(ORGANIZATION_REQUEST, action);
    if (!result.ok) throw new Error(accountErrors[result.code]);
    return result.view;
  },
  deviceDirectory: async (action) => {
    const result: DeviceDirectoryResult = await ipcRenderer.invoke(
      DEVICE_DIRECTORY_REQUEST,
      action,
    );
    if (!result.ok) throw new Error(accountErrors[result.code]);
    return result.keys;
  },
  account: async (action) => {
    const result: AccountResult = await ipcRenderer.invoke(ACCOUNT_REQUEST, action);
    if (!result.ok) throw new Error(accountErrors[result.code]);
    return result.state;
  },
  listSessionLogs: () => historyRequest<SessionLogSummary[]>(sessionLogChannels.list),
  getSessionLog: (id) => historyRequest<SessionLog>(sessionLogChannels.read, id),
  getLogRecordingState: () => historyRequest<LogRecordingState>(sessionLogChannels.state),
  startSessionLog: (id, title) => historyRequest<void>(sessionLogChannels.start, id, title),
  stopSessionLog: () => historyRequest<void>(sessionLogChannels.stop),
  annotateSessionLog: (id, annotation) =>
    historyRequest<void>(sessionLogChannels.annotate, id, annotation),
  deleteSessionLog: (id) => historyRequest<void>(sessionLogChannels.delete, id),
  onSessionLogsChanged: (listener) => {
    const handler = () => listener();
    ipcRenderer.on(SESSION_LOGS_CHANGED, handler);
    return () => ipcRenderer.removeListener(SESSION_LOGS_CHANGED, handler);
  },
  listBroadcastTargets: () => historyRequest<BatchTarget[]>(broadcastChannels.targets),
  getBroadcastState: () => historyRequest<BroadcastState>(broadcastChannels.state),
  startBroadcast: (targets) => historyRequest<BroadcastState>(broadcastChannels.start, targets),
  stopBroadcast: () => historyRequest<void>(broadcastChannels.stop),
  sendBroadcast: (id, action) => historyRequest<void>(broadcastChannels.send, id, action),
  onBroadcastChanged: (listener) => {
    const handler = () => listener();
    ipcRenderer.on(BROADCAST_CHANGED, handler);
    return () => ipcRenderer.removeListener(BROADCAST_CHANGED, handler);
  },
  listBatchTargets: () => historyRequest<BatchTarget[]>(batchChannels.targets),
  prepareBatch: (request) => historyRequest<BatchPreview>(batchChannels.prepare, request),
  startBatch: (token) => historyRequest<BatchState>(batchChannels.start, token),
  getBatchState: () => historyRequest<BatchState | null>(batchChannels.state),
  cancelBatch: (id) => historyRequest<void>(batchChannels.cancel, id),
  onBatchChanged: (listener) => {
    const handler = () => listener();
    ipcRenderer.on(BATCH_CHANGED, handler);
    return () => ipcRenderer.removeListener(BATCH_CHANGED, handler);
  },
  listSerialPorts: () => proxyRequest<SerialPortInfo[]>(serialChannels.ports),
  listSerialProfiles: () => proxyRequest<SerialProfile[]>(serialChannels.profiles),
  saveSerialProfile: (settings, id) =>
    proxyRequest<SerialProfile>(serialChannels.save, settings, ...(id === undefined ? [] : [id])),
  deleteSerialProfile: (id) => proxyRequest<void>(serialChannels.delete, id),
  sendSerialBreak: (id) => proxyRequest<void>(serialChannels.sendBreak, id),
  openSerialTerminal: async (id, size, profileId) => {
    const result: TerminalOpenResult = await ipcRenderer.invoke(
      serialChannels.open,
      id,
      size,
      profileId,
    );
    if (!result.ok) throw new Error(failureMessages[result.code]);
  },
  getAgentStatus: () => ipcRenderer.invoke(AGENT_STATUS) as Promise<AgentStatus>,
  listProxies: () => proxyRequest<ProxySummary[]>(proxyChannels.list),
  saveProxy: (draft, password, id) =>
    proxyRequest<SavedProxy>(
      proxyChannels.save,
      draft,
      password,
      ...(id === undefined ? [] : [id]),
    ),
  deleteProxy: (id) => proxyRequest<void>(proxyChannels.delete, id),
  listForwardRules: (hostId) => forwardRequest<PortForwardRule[]>(forwardChannels.rules, hostId),
  saveForwardRule: (hostId, draft, id) =>
    forwardRequest<PortForwardRule>(
      forwardChannels.saveRule,
      hostId,
      draft,
      ...(id === undefined ? [] : [id]),
    ),
  deleteForwardRule: (id) => forwardRequest<void>(forwardChannels.deleteRule, id),
  getForwardState: () => forwardRequest<ActiveForward[]>(forwardChannels.state),
  startForward: (sessionId, ruleId) =>
    forwardRequest<void>(forwardChannels.start, sessionId, ruleId),
  stopForward: (sessionId, ruleId) => forwardRequest<void>(forwardChannels.stop, sessionId, ruleId),
  onForwardsChanged: (listener) => {
    const handler = () => listener();
    ipcRenderer.on(FORWARDS_CHANGED, handler);
    return () => ipcRenderer.removeListener(FORWARDS_CHANGED, handler);
  },
  getStartupSnippet: (target) => historyRequest<Snippet | null>(snippetChannels.startup, target),
  setStartupSnippet: (target, snippetId) =>
    historyRequest<void>(snippetChannels.setStartup, target, snippetId),
  listSnippets: () => historyRequest<Snippet[]>(snippetChannels.list),
  saveSnippet: (draft, id) => historyRequest<Snippet>(snippetChannels.save, draft, id),
  deleteSnippet: (id) => historyRequest<void>(snippetChannels.delete, id),
  onSnippetsChanged: (listener) => {
    const handler = () => listener();
    ipcRenderer.on(SNIPPETS_CHANGED, handler);
    return () => ipcRenderer.removeListener(SNIPPETS_CHANGED, handler);
  },
  listWorkspaceTemplates: () => ipcRenderer.invoke(templateChannels.list),
  saveWorkspaceTemplate: (draft) => ipcRenderer.invoke(templateChannels.save, draft),
  deleteWorkspaceTemplate: (id) => ipcRenderer.invoke(templateChannels.delete, id),
  getRemoteEdit: () => transferRequest<RemoteEditState | null>(remoteEditChannels.state),
  startRemoteEdit: (request) => transferRequest<void>(remoteEditChannels.start, request),
  reopenRemoteEdit: () => transferRequest<void>(remoteEditChannels.reopen),
  uploadRemoteEdit: () => transferRequest<void>(remoteEditChannels.upload),
  finishRemoteEdit: (choice) => transferRequest<string | null>(remoteEditChannels.finish, choice),
  onRemoteEditChanged: (listener) => {
    const receive = () => listener();
    ipcRenderer.on(REMOTE_EDIT_CHANGED, receive);
    return () => ipcRenderer.removeListener(REMOTE_EDIT_CHANGED, receive);
  },
  resolveTransferConflict: (id, token, choice) =>
    transferRequest<void>(transferChannels.resolve, id, token, choice),
  inspectTransferResume: (id, sessionId) =>
    transferRequest<TransferResumePreview>(transferChannels.inspectResume, id, sessionId),
  resumeTransfer: (token) => transferRequest<void>(transferChannels.resume, token),
  inspectTransferPartial: (id, sessionId) =>
    transferRequest<PartialCleanupPreview>(transferChannels.inspectPartial, id, sessionId),
  cleanupTransferPartial: (token) => transferRequest<void>(transferChannels.cleanupPartial, token),
  listTransferRecovery: () => transferRequest<TransferRecoveryRecord[]>(transferChannels.recovery),
  forgetTransferRecovery: (id) => transferRequest<void>(transferChannels.forget, id),
  listTransfers: () => transferRequest<TransferJob[]>(transferChannels.list),
  enqueueTransfer: (request) => transferRequest<void>(transferChannels.enqueue, request),
  cancelTransfer: (id) => transferRequest<void>(transferChannels.cancel, id),
  clearFinishedTransfers: () => transferRequest<void>(transferChannels.clear),
  onTransfersChanged: (listener) => {
    const receive = () => listener();
    ipcRenderer.on(TRANSFERS_CHANGED, receive);
    return () => ipcRenderer.removeListener(TRANSFERS_CHANGED, receive);
  },
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
  saveSshLogin: async (hostId, username, password) => {
    const result: VaultResponse<undefined> = await ipcRenderer.invoke(
      vaultChannels.saveLogin,
      hostId,
      username,
      password,
    );
    if (!result.ok) throw new Error(failureMessages[result.code]);
  },
  getSshPasswordStatus: async (identityId) => {
    const result: VaultResponse<SshPasswordStatus> = await ipcRenderer.invoke(
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
  writeClipboardText: async (text, options) => {
    const result: ClipboardWriteResult = await ipcRenderer.invoke(
      clipboardChannels.write,
      text,
      ...(options ? [{ primary: options.primary === true }] : []),
    );
    if (!result.ok) throw new Error(failureMessages[result.code]);
  },
  getShells: () => ipcRenderer.invoke(channels.shells),
  completeTerminalPaths: (id, prefix) =>
    historyRequest<import('../shared/path-completion.js').PathCompletion[]>(
      channels.completePaths,
      id,
      prefix,
    ),
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
