import { normalizeAccountEmail, validAccountId } from '../../../../../packages/shared/accounts.ts';
import {
  SHARED_LOG_LIMIT,
  SHARED_ANNOTATION_LIMIT,
  SHARED_LABEL_BYTES,
  SHARED_TRANSCRIPT_BYTES,
  SHARED_ANNOTATION_BYTES,
  sharedLogEnvelope,
  type SharedLogRequest,
} from '../../../../../packages/shared/shared-logs.ts';
import { ORGANIZATION_VAULT_KEY_PREFIX } from '../../shared/organization-vault.js';
import {
  logLabel,
  logLineOffset,
  validSessionLogText,
  type SessionLog,
} from '../../shared/session-logs.js';
import {
  readSharedLogNote,
  type SharedLogAction,
  type SharedLogRecord,
  type SharedLogSummary,
  type SharedLogsView,
} from '../../shared/shared-logs.js';
import { WorkspaceSyncFailure } from '../../shared/workspace-sync.js';
import { organizationVaultContext } from './organization-vault.js';
import {
  decodeSyncKey,
  openSyncPayload,
  sealSyncPayload,
  syncWriteProof,
} from './workspace-sync.js';

function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new WorkspaceSyncFailure('sync-format');
  return value as Record<string, unknown>;
}

function date(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    throw new WorkspaceSyncFailure('sync-format');
  return value;
}

function unseal(value: unknown, limit: number, key: Buffer, context: string): unknown {
  const envelope = sharedLogEnvelope(value, limit);
  if (!envelope) throw new WorkspaceSyncFailure('sync-format');
  return openSyncPayload(envelope, key, context, 1);
}

export async function sharedLogs(
  action: SharedLogAction,
  request: (payload: SharedLogRequest) => Promise<Record<string, unknown>>,
  readLocal: () => Promise<SessionLog[]>,
  confirmShare: (title: string) => Promise<boolean>,
): Promise<SharedLogsView> {
  const { organizationId, vaultId } = action;
  const target = { organizationId, vaultId };
  const context = `organization-log:${organizationId}:${vaultId}`;
  const key = decodeSyncKey(action.key, ORGANIZATION_VAULT_KEY_PREFIX);
  const proof = () => syncWriteProof(key, organizationVaultContext(organizationId, vaultId));

  function summary(value: unknown): SharedLogSummary {
    const { id, label, sharedAt, expiresAt } = row(value);
    if (!validAccountId(id)) throw new WorkspaceSyncFailure('sync-format');
    return {
      id,
      title: logLabel(unseal(label, SHARED_LABEL_BYTES, key, `${context}:${id}:label`), 100),
      sharedAt: date(sharedAt),
      expiresAt: date(expiresAt),
    };
  }

  function recording(value: unknown, logId: string): SharedLogRecord {
    const data = row(value);
    const details = summary(data);
    if (
      details.id !== logId ||
      !Array.isArray(data.annotations) ||
      data.annotations.length > SHARED_ANNOTATION_LIMIT
    )
      throw new WorkspaceSyncFailure('sync-format');
    const { text, recordedAt } = row(
      unseal(data.transcript, SHARED_TRANSCRIPT_BYTES, key, `${context}:${logId}:transcript`),
    );
    if (
      !validSessionLogText(text) ||
      typeof recordedAt !== 'number' ||
      !Number.isSafeInteger(recordedAt) ||
      recordedAt < 0 ||
      recordedAt > 8_640_000_000_000_000
    )
      throw new WorkspaceSyncFailure('sync-format');
    const annotations = data.annotations.map((entry: unknown) => {
      const { id, envelope, author, createdAt } = row(entry);
      if (
        !validAccountId(id) ||
        typeof author !== 'string' ||
        normalizeAccountEmail(author) !== author
      )
        throw new WorkspaceSyncFailure('sync-format');
      const note = readSharedLogNote(
        unseal(envelope, SHARED_ANNOTATION_BYTES, key, `${context}:${logId}:annotation:${id}`),
      );
      if (note.kind === 'bookmark') logLineOffset(text, note.line);
      return { ...note, id, author, createdAt: date(createdAt) };
    });
    return { ...details, text, recordedAt, annotations };
  }

  try {
    if (action.kind === 'list') {
      const { logs } = await request({ ...target, kind: 'list' });
      if (!Array.isArray(logs) || logs.length > SHARED_LOG_LIMIT)
        throw new WorkspaceSyncFailure('sync-format');
      return { logs: logs.map(summary) };
    }
    const { logId } = action;
    const scope = { ...target, logId };
    if (action.kind === 'remove') {
      await request({ ...scope, kind: 'remove' });
      return {};
    }
    if (action.kind === 'share') {
      const local = (await readLocal()).find((entry) => entry.id === logId);
      if (!local || local.reason === 'checkpoint')
        throw new WorkspaceSyncFailure('shared-log-local');
      if (!(await confirmShare(local.title))) return {};
      const label = sealSyncPayload(local.title, key, `${context}:${logId}:label`, 1, 1);
      const transcript = sealSyncPayload(
        { text: local.text, recordedAt: local.createdAt },
        key,
        `${context}:${logId}:transcript`,
        1,
        1,
      );
      const result = await request({
        ...scope,
        kind: 'share',
        label,
        transcript,
        writeProof: proof(),
      });
      if (result.id !== logId) throw new WorkspaceSyncFailure('sync-format');
      return { sharedId: logId };
    }
    const current = recording((await request({ ...scope, kind: 'read' })).log, logId);
    if (action.kind !== 'annotate') return { recording: current };
    if (action.note.kind === 'bookmark') {
      try {
        logLineOffset(current.text, action.note.line);
      } catch {
        throw new WorkspaceSyncFailure('shared-log-line');
      }
    }
    const { annotationId } = action;
    const envelope = sealSyncPayload(
      action.note,
      key,
      `${context}:${logId}:annotation:${annotationId}`,
      1,
      1,
    );
    const result = await request({
      ...scope,
      kind: 'annotate',
      annotationId,
      envelope,
      writeProof: proof(),
    });
    return { recording: recording(result.log, logId) };
  } finally {
    key.fill(0);
  }
}
