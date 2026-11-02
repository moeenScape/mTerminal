import type { FileErrorCode } from './files.js';
export const transferChannels = {
  list: 'transfers:list',
  enqueue: 'transfers:enqueue',
  cancel: 'transfers:cancel',
  clear: 'transfers:clear',
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
  'queued' | 'running' | 'cancelling' | 'completed' | 'cancelled' | 'failed' | 'uncertain';
export interface TransferJob extends TransferRequest {
  id: string;
  state: TransferState;
  transferred: number;
  total: number | null;
  error: FileErrorCode | null;
  partialPath: string | null;
}
export function transferActive(state: TransferState) {
  return state === 'queued' || state === 'running' || state === 'cancelling';
}
export type TransferResponse<T> = { ok: true; value: T } | { ok: false; code: FileErrorCode };
export interface TransfersApi {
  listTransfers: () => Promise<TransferJob[]>;
  enqueueTransfer: (request: TransferRequest) => Promise<void>;
  cancelTransfer: (id: string) => Promise<void>;
  clearFinishedTransfers: () => Promise<void>;
  onTransfersChanged: (listener: () => void) => () => void;
}
