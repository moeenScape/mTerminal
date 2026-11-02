import type { FileErrorCode } from './files.js';
import type { FileEntry } from './files.js';
export const transferChannels = {
  list: 'transfers:list',
  enqueue: 'transfers:enqueue',
  cancel: 'transfers:cancel',
  clear: 'transfers:clear',
  resolve: 'transfers:resolve',
} as const;
export const TRANSFERS_CHANGED = 'transfers:changed';
export const TRANSFER_LIMIT = 32;
export interface TransferRequest {
  sessionId: string;
  title: string;
  direction: 'upload' | 'download';
  localDirectory: string;
  remoteDirectory: string;
  name: string;
}
export type TransferState =
  | 'queued'
  | 'running'
  | 'conflict'
  | 'cancelling'
  | 'completed'
  | 'skipped'
  | 'cancelled'
  | 'failed'
  | 'uncertain';
export interface TransferFileInfo extends Pick<
  FileEntry,
  'path' | 'kind' | 'size' | 'modified' | 'permissions'
> {
  version: string;
}
export interface TransferConflictPreview {
  token: string;
  source: TransferFileInfo;
  destination: TransferFileInfo;
  replaceable: boolean;
}
export interface TransferJob extends TransferRequest {
  id: string;
  state: TransferState;
  transferred: number;
  total: number | null;
  error: FileErrorCode | null;
  partialPath: string | null;
  backupPath: string | null;
  conflict: TransferConflictPreview | null;
}
export function transferActive(state: TransferState) {
  return (
    state === 'queued' || state === 'running' || state === 'conflict' || state === 'cancelling'
  );
}
export type TransferResponse<T> = { ok: true; value: T } | { ok: false; code: FileErrorCode };
export interface TransfersApi {
  listTransfers: () => Promise<TransferJob[]>;
  enqueueTransfer: (request: TransferRequest) => Promise<void>;
  cancelTransfer: (id: string) => Promise<void>;
  resolveTransferConflict: (id: string, token: string, choice: 'replace' | 'skip') => Promise<void>;
  clearFinishedTransfers: () => Promise<void>;
  onTransfersChanged: (listener: () => void) => () => void;
}
