import { validAccountId, validAccountToken } from './accounts.ts';
import { parseSyncEnvelope, type SyncEnvelope } from './workspace-sync.ts';

export const SHARED_LOGS_ROUTE = '/v1/shared-logs';
export const SHARED_LOG_LIMIT = 20;
export const SHARED_LABEL_BYTES = 1024;
export const SHARED_TRANSCRIPT_BYTES = 270336;
export const SHARED_ANNOTATION_BYTES = 4096;
export const SHARED_ANNOTATION_LIMIT = 100;

export interface SharedLogEntry {
  id: string;
  sharedAt: string;
  expiresAt: string;
  label: SyncEnvelope;
}

interface LogScope {
  organizationId: string;
  vaultId: string;
}

export type SharedLogRequest = LogScope &
  (
    | { kind: 'list' }
    | { kind: 'read' | 'remove'; logId: string }
    | {
        kind: 'share';
        logId: string;
        label: SyncEnvelope;
        transcript: SyncEnvelope;
        writeProof: string;
      }
    | {
        kind: 'annotate';
        logId: string;
        annotationId: string;
        envelope: SyncEnvelope;
        writeProof: string;
      }
  );

export function sharedLogEnvelope(value: unknown, max: number): SyncEnvelope | undefined {
  const envelope = parseSyncEnvelope(value);
  return envelope?.version === 1 && envelope.ciphertext.length <= max ? envelope : undefined;
}

export function parseSharedLogRequest(
  input: Record<string, unknown>,
): SharedLogRequest | undefined {
  const { kind, organizationId, vaultId, logId, annotationId, writeProof } = input;
  if (!validAccountId(organizationId) || !validAccountId(vaultId)) return;
  const scope = { organizationId: organizationId.toLowerCase(), vaultId: vaultId.toLowerCase() };
  const count = Object.keys(input).length;
  if (kind === 'list' && count === 3) return { ...scope, kind };
  if (!validAccountId(logId)) return;
  const id = logId.toLowerCase();
  if ((kind === 'read' || kind === 'remove') && count === 4) return { ...scope, kind, logId: id };
  if (kind === 'share' && count === 7 && validAccountToken(writeProof)) {
    const label = sharedLogEnvelope(input.label, SHARED_LABEL_BYTES);
    const transcript = sharedLogEnvelope(input.transcript, SHARED_TRANSCRIPT_BYTES);
    if (label && transcript) return { ...scope, kind, logId: id, label, transcript, writeProof };
  }
  if (
    kind === 'annotate' &&
    count === 7 &&
    validAccountId(annotationId) &&
    validAccountToken(writeProof)
  ) {
    const envelope = sharedLogEnvelope(input.envelope, SHARED_ANNOTATION_BYTES);
    if (envelope)
      return {
        ...scope,
        kind,
        logId: id,
        annotationId: annotationId.toLowerCase(),
        envelope,
        writeProof,
      };
  }
}
