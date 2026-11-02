import type { FileErrorCode } from './files.js';
export const REMOTE_EDIT_MAX_BYTES = 1024 * 1024;
export const remoteEditChannels = {
  state: 'remote-edit:state',
  start: 'remote-edit:start',
  reopen: 'remote-edit:reopen',
  upload: 'remote-edit:upload',
  finish: 'remote-edit:finish',
} as const;
export const REMOTE_EDIT_CHANGED = 'remote-edit:changed';
export interface RemoteEditRequest {
  sessionId: string;
  title: string;
  remoteDirectory: string;
  name: string;
}
export interface RemoteEditState extends RemoteEditRequest {
  id: string;
  localPath: string;
  workingDirectory: string;
  phase: 'downloading' | 'ready' | 'uploading' | 'conflict' | 'failed' | 'uncertain';
  changed: boolean;
  connected: boolean;
  hasCopy: boolean;
  size: number;
  error: FileErrorCode | null;
  transferId: string | null;
  backupPath: string | null;
  partialPath: string | null;
}
export interface RemoteEditApi {
  getRemoteEdit: () => Promise<RemoteEditState | null>;
  startRemoteEdit: (request: RemoteEditRequest) => Promise<void>;
  reopenRemoteEdit: () => Promise<void>;
  uploadRemoteEdit: () => Promise<void>;
  finishRemoteEdit: (choice: 'keep' | 'discard') => Promise<string | null>;
  onRemoteEditChanged: (listener: () => void) => () => void;
}
