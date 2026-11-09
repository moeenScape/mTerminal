import { validHostId } from './hosts.js';
import { validateSnippet } from './snippets.js';
export const batchChannels = {
  targets: 'batch:targets',
  prepare: 'batch:prepare',
  start: 'batch:start',
  state: 'batch:state',
  cancel: 'batch:cancel',
} as const;
export const BATCH_CHANGED = 'batch:changed';
export const BATCH_MAX_TARGETS = 16;
export const BATCH_CONCURRENCY = 3;
export const BATCH_OUTPUT_BYTES = 64 * 1024;
export const BATCH_TIMEOUT_MS = 60000;
export interface BatchTarget {
  sessionId: string;
  address: string;
  port: number;
  username: string;
  fingerprint: string;
}
export type ExecutionStatus =
  'succeeded' | 'failed' | 'cancelled' | 'timed-out' | 'output-limit' | 'disconnected';
export interface CommandResult {
  status: ExecutionStatus;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  exitSignal: string | null;
}
export interface BatchPreview {
  token: string;
  expiresAt: number;
  command: string;
  targets: BatchTarget[];
}
export interface BatchRow extends Omit<CommandResult, 'status'> {
  target: BatchTarget;
  status: ExecutionStatus | 'queued' | 'running';
}
export interface BatchState {
  id: string;
  command: string;
  results: BatchRow[];
  finished: boolean;
  cancelRequested: boolean;
}
export interface BatchApi {
  listBatchTargets: () => Promise<BatchTarget[]>;
  prepareBatch: (request: { command: string; sessionIds: string[] }) => Promise<BatchPreview>;
  startBatch: (token: string) => Promise<BatchState>;
  getBatchState: () => Promise<BatchState | null>;
  cancelBatch: (id: string) => Promise<void>;
  onBatchChanged: (listener: () => void) => () => void;
}
export function validateBatchRequest(value: unknown): { command: string; sessionIds: string[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid command batch.');
  const request = value as Record<string, unknown>;
  if (
    Object.keys(request).some((key) => !['command', 'sessionIds'].includes(key)) ||
    !Array.isArray(request.sessionIds) ||
    !request.sessionIds.length ||
    request.sessionIds.length > BATCH_MAX_TARGETS
  )
    throw new Error('Select 1–16 destinations.');
  const sessionIds = Array.from(request.sessionIds);
  if (sessionIds.some((id) => !validHostId(id)) || new Set(sessionIds).size !== sessionIds.length)
    throw new Error('Invalid or duplicate destinations.');
  const command = validateSnippet({
    name: 'Command batch',
    command: request.command,
    folder: '',
    tags: [],
  }).command;
  return { command, sessionIds: sessionIds as string[] };
}
export function batchTargetKey(target: BatchTarget): string {
  return JSON.stringify([target.address, target.port, target.username, target.fingerprint]);
}
