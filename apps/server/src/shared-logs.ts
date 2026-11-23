import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  SHARED_ANNOTATION_LIMIT,
  SHARED_LOG_LIMIT,
  type SharedLogRequest,
} from '../../../packages/shared/shared-logs.ts';
import { AccountFailure } from './account-failure.ts';
import { requireVaultAccess } from './vault-access.ts';

export async function purgeSharedLogs(pool: Pool): Promise<void> {
  await pool.query(
    `DELETE FROM organization_shared_logs WHERE (organization_id, vault_id, id) IN (
       SELECT organization_id, vault_id, id FROM organization_shared_logs
       WHERE expires_at <= now() FOR UPDATE SKIP LOCKED
     )`,
  );
}

export async function sharedLogs(
  client: PoolClient,
  account: { id: string; email: string },
  action: SharedLogRequest,
) {
  const scope = [action.organizationId, action.vaultId];
  const access = await requireVaultAccess(
    client,
    account.id,
    action.organizationId,
    action.vaultId,
  );
  if (action.kind === 'list') {
    const logs = await client.query(
      `SELECT id, label, shared_at AS "sharedAt", expires_at AS "expiresAt"
       FROM organization_shared_logs WHERE organization_id = $1 AND vault_id = $2
         AND expires_at > clock_timestamp()
       ORDER BY shared_at DESC, id LIMIT $3`,
      [...scope, SHARED_LOG_LIMIT],
    );
    return { logs: logs.rows };
  }
  const entry = [...scope, action.logId];
  if (action.kind === 'remove') {
    if (access !== 'owner') throw new AccountFailure('organization-vault-denied');
    await client.query(
      'DELETE FROM organization_shared_logs WHERE organization_id = $1 AND vault_id = $2 AND id = $3',
      entry,
    );
    return {};
  }
  if (action.kind === 'share' || action.kind === 'annotate') {
    if (access === 'reader') throw new AccountFailure('organization-vault-denied');
    const proof = createHash('sha256').update(action.writeProof).digest('hex');
    const vault = await client.query(
      'SELECT 1 FROM organization_vaults WHERE organization_id = $1 AND vault_id = $2 AND write_hash = $3',
      [...scope, proof],
    );
    if (!vault.rowCount) throw new AccountFailure('shared-log-key');
    if (action.kind === 'share') {
      await client.query(
        'DELETE FROM organization_shared_logs WHERE organization_id = $1 AND vault_id = $2 AND expires_at <= clock_timestamp()',
        scope,
      );
      const saved = await client.query(
        `INSERT INTO organization_shared_logs (organization_id, vault_id, id, label, transcript)
         SELECT $1::uuid, $2::uuid, $3::uuid, $4::jsonb, $5::jsonb
         WHERE (SELECT count(*) FROM organization_shared_logs WHERE organization_id = $1 AND vault_id = $2) < $6
            OR EXISTS (SELECT 1 FROM organization_shared_logs WHERE organization_id = $1 AND vault_id = $2 AND id = $3)
         ON CONFLICT (organization_id, vault_id, id) DO UPDATE SET id = excluded.id
         RETURNING id`,
        [
          ...entry,
          JSON.stringify(action.label),
          JSON.stringify(action.transcript),
          SHARED_LOG_LIMIT,
        ],
      );
      if (!saved.rowCount) throw new AccountFailure('shared-log-limit');
      return { id: action.logId };
    }
  }
  const selected = await client.query(
    `SELECT id, label, transcript, shared_at AS "sharedAt", expires_at AS "expiresAt"
     FROM organization_shared_logs WHERE organization_id = $1 AND vault_id = $2 AND id = $3
       AND expires_at > clock_timestamp() FOR KEY SHARE`,
    entry,
  );
  const log = selected.rows[0];
  if (!log) throw new AccountFailure('shared-log-missing');
  if (action.kind === 'annotate') {
    const saved = await client.query(
      `INSERT INTO organization_log_annotations (organization_id, vault_id, log_id, id, author_email, envelope)
       SELECT $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, $6::jsonb
       WHERE (SELECT count(*) FROM organization_log_annotations
              WHERE organization_id = $1 AND vault_id = $2 AND log_id = $3) < $7
          OR EXISTS (SELECT 1 FROM organization_log_annotations
                     WHERE organization_id = $1 AND vault_id = $2 AND log_id = $3 AND id = $4)
       ON CONFLICT (organization_id, vault_id, log_id, id) DO UPDATE SET id = excluded.id
       RETURNING id`,
      [
        ...entry,
        action.annotationId,
        account.email,
        JSON.stringify(action.envelope),
        SHARED_ANNOTATION_LIMIT,
      ],
    );
    if (!saved.rowCount) throw new AccountFailure('shared-log-limit');
  }
  const annotations = await client.query(
    `SELECT id, author_email AS author, created_at AS "createdAt", envelope FROM organization_log_annotations
     WHERE organization_id = $1 AND vault_id = $2 AND log_id = $3 ORDER BY created_at, id`,
    entry,
  );
  return { log: { ...log, annotations: annotations.rows } };
}
