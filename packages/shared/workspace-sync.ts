export const WORKSPACE_SYNC_ROUTE = '/v1/accounts/workspace-sync';
export const SYNC_PLAINTEXT_LIMIT = 1024 * 1024;
export const SYNC_CIPHERTEXT_LIMIT = Math.ceil((SYNC_PLAINTEXT_LIMIT * 4) / 3);
export const SYNC_HTTP_LIMIT = SYNC_CIPHERTEXT_LIMIT + 1024;
export const SYNC_MAX_REVISION = 2_147_483_647;

export interface SyncEnvelope {
  version: 1 | 2;
  nonce: string;
  tag: string;
  ciphertext: string;
}

export interface SyncSnapshot {
  maxEnvelopeVersion?: 2;
  accountId: string;
  revision: number;
  envelope: SyncEnvelope | null;
}

export function validSyncRevision(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= SYNC_MAX_REVISION
  );
}

export function parseSyncEnvelope(value: unknown): SyncEnvelope | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const { version, nonce, tag, ciphertext } = value as Record<string, unknown>;
  if (
    Object.keys(value).length !== 4 ||
    (version !== 1 && version !== 2) ||
    typeof nonce !== 'string' ||
    !/^[A-Za-z0-9_-]{16}$/.test(nonce) ||
    typeof tag !== 'string' ||
    !/^[A-Za-z0-9_-]{22}$/.test(tag) ||
    typeof ciphertext !== 'string' ||
    ciphertext.length > SYNC_CIPHERTEXT_LIMIT ||
    ciphertext.length % 4 === 1 ||
    !/^[A-Za-z0-9_-]+$/.test(ciphertext)
  )
    return undefined;
  return { version, nonce, tag, ciphertext };
}
