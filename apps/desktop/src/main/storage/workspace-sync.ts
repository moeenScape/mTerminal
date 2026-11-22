import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { validAccountId } from '../../../../../packages/shared/accounts.ts';
import {
  parseSyncEnvelope,
  SYNC_MAX_REVISION,
  SYNC_PLAINTEXT_LIMIT,
  validSyncRevision,
  WORKSPACE_SYNC_ROUTE,
  type SyncEnvelope,
  type SyncSnapshot,
} from '../../../../../packages/shared/workspace-sync.ts';
import { type WorkspaceBackup } from '../../shared/backup.js';
import {
  syncAdditions,
  syncMetadata,
  WorkspaceSyncFailure,
  type WorkspaceSyncResult,
} from '../../shared/workspace-sync.js';
import type { LocalDatabase } from './database.js';

const KEY_PREFIX = 'mterminal-sync-v1_';
const TAG_BYTES = 16;

export function generateSyncKey(): string {
  return KEY_PREFIX + randomBytes(32).toString('base64url');
}

export function decodeSyncKey(value: unknown): Buffer {
  if (
    typeof value !== 'string' ||
    value.length !== KEY_PREFIX.length + 43 ||
    !value.startsWith(KEY_PREFIX)
  )
    throw new WorkspaceSyncFailure('sync-key');
  const encoded = value.slice(KEY_PREFIX.length);
  const key = Buffer.from(encoded, 'base64url');
  if (key.length !== 32 || key.toString('base64url') !== encoded) {
    key.fill(0);
    throw new WorkspaceSyncFailure('sync-key');
  }
  return key;
}

function syncContext(accountId: string, revision: number): Buffer {
  return Buffer.from(`mterminal-workspace-sync:v1:${accountId}:${revision}`);
}

function deriveKey(
  rootKey: Buffer,
  accountId: string,
  purpose: 'encryption' | 'publication',
): Buffer {
  return Buffer.from(
    hkdfSync('sha256', rootKey, accountId, `mterminal-workspace-sync:v1:${purpose}`, 32),
  );
}

export function encryptWorkspace(
  value: unknown,
  key: Buffer,
  accountId: string,
  revision: number,
): SyncEnvelope {
  const plaintext = Buffer.from(JSON.stringify(syncMetadata(value)));
  const encryptionKey = deriveKey(key, accountId, 'encryption');
  try {
    if (plaintext.length > SYNC_PLAINTEXT_LIMIT) throw new WorkspaceSyncFailure('sync-size');
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', encryptionKey, nonce, {
      authTagLength: TAG_BYTES,
    });
    cipher.setAAD(syncContext(accountId, revision));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return {
      version: 1,
      nonce: nonce.toString('base64url'),
      tag: cipher.getAuthTag().toString('base64url'),
      ciphertext: ciphertext.toString('base64url'),
    };
  } finally {
    plaintext.fill(0);
    encryptionKey.fill(0);
  }
}

export function decryptWorkspace(
  envelope: SyncEnvelope,
  key: Buffer,
  accountId: string,
  revision: number,
): WorkspaceBackup {
  const encryptionKey = deriveKey(key, accountId, 'encryption');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey,
    Buffer.from(envelope.nonce, 'base64url'),
    { authTagLength: TAG_BYTES },
  );
  encryptionKey.fill(0);
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
  decipher.setAAD(syncContext(accountId, revision));
  const plaintext = decipher.update(Buffer.from(envelope.ciphertext, 'base64url'));
  try {
    try {
      decipher.final();
    } catch {
      throw new WorkspaceSyncFailure('sync-key');
    }
    let data: unknown;
    try {
      data = JSON.parse(plaintext.toString('utf8'));
    } catch {
      throw new WorkspaceSyncFailure('sync-format');
    }
    return syncMetadata(data);
  } finally {
    plaintext.fill(0);
  }
}

function readSnapshot(value: Record<string, unknown>): SyncSnapshot {
  const { accountId, revision } = value;
  if (!validAccountId(accountId) || !validSyncRevision(revision))
    throw new WorkspaceSyncFailure('sync-format');
  if (revision === 0 && value.envelope === null) return { accountId, revision, envelope: null };
  const envelope = parseSyncEnvelope(value.envelope);
  if (!envelope || revision === 0) throw new WorkspaceSyncFailure('sync-format');
  return { accountId, revision, envelope };
}

type SyncRequest = (
  path: string,
  method: 'GET' | 'PUT',
  body?: object,
) => Promise<Record<string, unknown>>;

export async function publishWorkspace(
  local: WorkspaceBackup,
  key: Buffer,
  request: SyncRequest,
  expectedAccountId?: string,
): Promise<Extract<WorkspaceSyncResult, { revision: number }>> {
  const { accountId, revision, envelope } = readSnapshot(
    await request(WORKSPACE_SYNC_ROUTE, 'GET'),
  );
  if (expectedAccountId !== undefined && accountId !== expectedAccountId)
    throw new WorkspaceSyncFailure('sign-in-required');
  const cloud = envelope ? decryptWorkspace(envelope, key, accountId, revision) : undefined;
  const additions = cloud ? syncAdditions(cloud, local) : local;
  const count = additions.hosts.length + additions.groups.length + additions.identities.length;
  if (count === 0) {
    if (!cloud) throw new WorkspaceSyncFailure('sync-empty');
    return { kind: 'published', revision, count };
  }
  if (revision >= SYNC_MAX_REVISION) throw new WorkspaceSyncFailure('sync-format');
  const data: WorkspaceBackup = {
    ...local,
    hosts: [...(cloud?.hosts ?? []), ...additions.hosts],
    groups: [...(cloud?.groups ?? []), ...additions.groups],
    identities: [...(cloud?.identities ?? []), ...additions.identities],
  };
  const publicationKey = deriveKey(key, accountId, 'publication');
  const writeProof = publicationKey.toString('base64url');
  publicationKey.fill(0);
  const result = await request(WORKSPACE_SYNC_ROUTE, 'PUT', {
    expectedRevision: revision,
    envelope: encryptWorkspace(data, key, accountId, revision + 1),
    writeProof,
  });
  if (result.revision !== revision + 1) throw new WorkspaceSyncFailure('sync-format');
  return { kind: 'published', revision: result.revision, count };
}

export async function syncWorkspace(
  action: unknown,
  database: Pick<LocalDatabase, 'exportWorkspace' | 'mergeSyncedWorkspace'>,
  request: SyncRequest,
): Promise<WorkspaceSyncResult> {
  if (!action || typeof action !== 'object') throw new WorkspaceSyncFailure('invalid-input');
  const { kind, key: input } = action as Record<string, unknown>;
  if (kind === 'generate-key') {
    const snapshot = readSnapshot(await request(WORKSPACE_SYNC_ROUTE, 'GET'));
    if (snapshot.revision !== 0) throw new WorkspaceSyncFailure('sync-exists');
    return { kind: 'generated', key: generateSyncKey() };
  }
  if (kind !== 'publish' && kind !== 'merge') throw new WorkspaceSyncFailure('invalid-input');
  const key = decodeSyncKey(input);
  try {
    if (kind === 'publish')
      return await publishWorkspace(syncMetadata(database.exportWorkspace()), key, request);
    const { accountId, revision, envelope } = readSnapshot(
      await request(WORKSPACE_SYNC_ROUTE, 'GET'),
    );
    if (!envelope) throw new WorkspaceSyncFailure('sync-empty');
    const cloud = decryptWorkspace(envelope, key, accountId, revision);
    return { kind: 'merged', revision, count: database.mergeSyncedWorkspace(cloud) };
  } finally {
    key.fill(0);
  }
}
