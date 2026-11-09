import type { FileErrorCode } from './files.js';
import type { FileEntry } from './files.js';
export const transferChannels = {
  list: 'transfers:list',
  enqueue: 'transfers:enqueue',
  cancel: 'transfers:cancel',
  clear: 'transfers:clear',
  resolve: 'transfers:resolve',
  recovery: 'transfers:recovery',
  forget: 'transfers:forget',
  inspectPartial: 'transfers:inspect-partial',
  cleanupPartial: 'transfers:cleanup-partial',
  inspectResume: 'transfers:inspect-resume',
  resume: 'transfers:resume',
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
  source: TransferFileInfo | null;
  destination: TransferFileInfo | null;
}
export function transferActive(state: TransferState) {
  return (
    state === 'queued' || state === 'running' || state === 'conflict' || state === 'cancelling'
  );
}
export type TransferResponse<T> = { ok: true; value: T } | { ok: false; code: FileErrorCode };
export interface TransferPeer {
  address: string;
  port: number;
  username: string;
  fingerprint: string;
}
export interface PartialInspection {
  file: TransferFileInfo;
  digest: string;
}
export interface PartialCleanupPreview extends PartialInspection {
  token: string;
  recordId: string;
  side: 'local' | 'remote';
  peer: TransferPeer;
}
export interface ResumeInspection extends PartialInspection {
  destination: TransferFileInfo | null;
  total: number;
  remaining: number;
}
export interface TransferResumePreview extends PartialCleanupPreview, ResumeInspection {}
export interface TransferCheckpoint {
  staging?: TransferFileInfo;
  phase: 'queued' | 'staging' | 'backup' | 'publishing' | 'settled';
  partialPath: string | null;
  backupPath: string | null;
  source: TransferFileInfo | null;
  destination: TransferFileInfo | null;
}
export interface TransferRecoveryRecord extends TransferRequest, TransferCheckpoint {
  id: string;
  state: TransferState;
  peer: TransferPeer | null;
  updatedAt: string;
}
export interface TransfersApi {
  inspectTransferResume: (id: string, sessionId: string) => Promise<TransferResumePreview>;
  resumeTransfer: (token: string) => Promise<void>;
  inspectTransferPartial: (id: string, sessionId: string) => Promise<PartialCleanupPreview>;
  cleanupTransferPartial: (token: string) => Promise<void>;
  listTransferRecovery: () => Promise<TransferRecoveryRecord[]>;
  forgetTransferRecovery: (id: string) => Promise<void>;
  listTransfers: () => Promise<TransferJob[]>;
  enqueueTransfer: (request: TransferRequest) => Promise<void>;
  cancelTransfer: (id: string) => Promise<void>;
  resolveTransferConflict: (id: string, token: string, choice: 'replace' | 'skip') => Promise<void>;
  clearFinishedTransfers: () => Promise<void>;
  onTransfersChanged: (listener: () => void) => () => void;
}
