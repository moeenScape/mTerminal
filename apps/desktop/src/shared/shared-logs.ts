import { validAccountId, type AccountErrorCode } from '../../../../packages/shared/accounts.ts';
import { logLabel, MAX_LOG_CHARACTERS } from './session-logs.js';
import { ORGANIZATION_VAULT_KEY_PREFIX } from './organization-vault.js';

export const SHARED_LOGS_REQUEST = 'account:shared-logs';

export interface SharedLogSummary {
  id: string;
  title: string;
  sharedAt: string;
  expiresAt: string;
}

export type SharedLogNote =
  { kind: 'comment'; text: string } | { kind: 'bookmark'; text: string; line: number };

export interface SharedLogRecord extends SharedLogSummary {
  text: string;
  recordedAt: number;
  annotations: (SharedLogNote & { id: string; author: string; createdAt: string })[];
}

type SharedLogTarget = { organizationId: string; vaultId: string; key: string };
export type SharedLogAction = SharedLogTarget &
  (
    | { kind: 'list' }
    | { kind: 'read' | 'share' | 'remove'; logId: string }
    | { kind: 'annotate'; logId: string; annotationId: string; note: SharedLogNote }
  );

export interface SharedLogsView {
  logs?: SharedLogSummary[];
  recording?: SharedLogRecord;
  sharedId?: string;
}

export type SharedLogsReply =
  { ok: true; view: SharedLogsView } | { ok: false; code: AccountErrorCode };

export interface SharedLogsApi {
  sharedLogs: (action: SharedLogAction) => Promise<SharedLogsView>;
}

export function readSharedLogNote(value: unknown): SharedLogNote {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid note.');
  const { kind, line, text } = value as Record<string, unknown>;
  const count = Object.keys(value).length;
  if (kind === 'comment' && count === 2) return { kind, text: logLabel(text, 512).trim() };
  if (
    kind === 'bookmark' &&
    count === 3 &&
    typeof line === 'number' &&
    Number.isSafeInteger(line) &&
    line > 0 &&
    line <= MAX_LOG_CHARACTERS + 1
  )
    return { kind, line, text: logLabel(text, 256, true).trim() };
  throw new Error('Invalid note.');
}

export function parseSharedLogAction(value: unknown): SharedLogAction | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const { kind, organizationId, vaultId, key, logId, annotationId, note } = value as Record<
    string,
    unknown
  >;
  if (
    !validAccountId(organizationId) ||
    !validAccountId(vaultId) ||
    typeof key !== 'string' ||
    key.length !== ORGANIZATION_VAULT_KEY_PREFIX.length + 43
  )
    return;
  const target = {
    organizationId: organizationId.toLowerCase(),
    vaultId: vaultId.toLowerCase(),
    key,
  };
  const count = Object.keys(value).length;
  if (kind === 'list' && count === 4) return { ...target, kind };
  if (!validAccountId(logId)) return;
  const id = logId.toLowerCase();
  if ((kind === 'share' || kind === 'read' || kind === 'remove') && count === 5)
    return { ...target, kind, logId: id };
  if (kind === 'annotate' && count === 7 && validAccountId(annotationId)) {
    try {
      return {
        ...target,
        kind,
        logId: id,
        annotationId: annotationId.toLowerCase(),
        note: readSharedLogNote(note),
      };
    } catch {
      return;
    }
  }
}
