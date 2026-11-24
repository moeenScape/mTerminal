import { normalizeAccountEmail, validAccountId } from './accounts.ts';
import { parseSyncEnvelope, type SyncEnvelope } from './workspace-sync.ts';

export const LIVE_SHARE_ROUTE = '/v1/live-terminal';
export const LIVE_FRAME_CHARS = 4096;
export const LIVE_FRAME_LIMIT = 32768;
export const LIVE_BATCH = 8;

export type LiveRelayAction =
  | { kind: 'start'; organizationId: string; vaultId: string; email: string }
  | { kind: 'push'; room: string; frame?: SyncEnvelope; sequence?: number }
  | { kind: 'view'; room: string; after: number }
  | { kind: 'stop'; room: string };

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
