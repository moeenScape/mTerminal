import { normalizeAccountEmail, validAccountId } from './accounts.ts';
import { parseSyncEnvelope, type SyncEnvelope } from './workspace-sync.ts';

export const LIVE_SHARE_ROUTE = '/v1/live-terminal';
export const LIVE_FRAME_CHARS = 4096;
export const LIVE_FRAME_LIMIT = 32768;
export const LIVE_BATCH = 8;
export const LIVE_INPUT_CHARS = 1024;

export interface LiveTypingGrant {
  lease: string;
  next: number;
  ready: boolean;
}

export function validLiveInput(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= LIVE_INPUT_CHARS &&
    !/[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u.test(value)
  );
}

export type LiveRelayAction =
  | { kind: 'start'; organizationId: string; vaultId: string; email: string }
  | { kind: 'push'; room: string; frame?: SyncEnvelope; sequence?: number }
  | { kind: 'view'; room: string; after: number }
  | { kind: 'stop'; room: string }
  | { kind: 'control'; room: string; revision: number; lease: string | null }
  | { kind: 'input'; room: string; lease: string; sequence: number; frame: SyncEnvelope }
  | { kind: 'yield'; room: string; lease: string };

export function parseLiveFrame(value: unknown): SyncEnvelope | undefined {
  const frame = parseSyncEnvelope(value);
  return frame?.version === 1 && frame.ciphertext.length <= LIVE_FRAME_LIMIT ? frame : undefined;
}

export function parseLiveRelayAction(value: Record<string, unknown>): LiveRelayAction | undefined {
  const { kind, organizationId, vaultId, room, frame, after, sequence } = value;
  const count = Object.keys(value).length;
  if (
    kind === 'start' &&
    count === 4 &&
    validAccountId(organizationId) &&
    validAccountId(vaultId)
  ) {
    const email = normalizeAccountEmail(value.email);
    if (email)
      return {
        kind,
        organizationId: organizationId.toLowerCase(),
        vaultId: vaultId.toLowerCase(),
        email,
      };
  }
  if (!validAccountId(room)) return;
  const id = room.toLowerCase();
  const { lease, revision } = value;
  if (
    kind === 'control' &&
    count === 4 &&
    (lease === null || validAccountId(lease)) &&
    typeof revision === 'number' &&
    Number.isSafeInteger(revision) &&
    revision > 0
  )
    return { kind, room: id, revision, lease: lease?.toLowerCase() ?? null };
  if (kind === 'yield' && count === 3 && validAccountId(lease))
    return { kind, room: id, lease: lease.toLowerCase() };
  if (
    kind === 'input' &&
    count === 5 &&
    validAccountId(lease) &&
    typeof sequence === 'number' &&
    Number.isSafeInteger(sequence) &&
    sequence > 0
  ) {
    const parsed = parseLiveFrame(frame);
    if (parsed && parsed.ciphertext.length <= 8192)
      return { kind, room: id, lease: lease.toLowerCase(), sequence, frame: parsed };
  }
  if (kind === 'stop' && count === 2) return { kind, room: id };
  if (
    kind === 'view' &&
    count === 3 &&
    typeof after === 'number' &&
    Number.isSafeInteger(after) &&
    after >= 0
  )
    return { kind, room: id, after };
  if (kind === 'push' && count === 2) return { kind, room: id };
  if (
    kind === 'push' &&
    count === 4 &&
    typeof sequence === 'number' &&
    Number.isSafeInteger(sequence) &&
    sequence > 0
  ) {
    const parsed = parseLiveFrame(frame);
    if (parsed) return { kind, room: id, frame: parsed, sequence };
  }
}
