import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type {
  OrganizationVaultSnapshot,
  OrganizationVaultWrite,
  VaultAccess,
  VaultAccessAction,
  VaultAccessView,
  VaultAdministration,
  VaultDescriptor,
  VaultGrant,
} from '../../../packages/shared/organization-vault.ts';
import { AccountFailure } from './account-failure.ts';
import { lockOrganization } from './organizations.ts';

async function organizationOwner(
  client: PoolClient,
  organizationId: string,
  accountId: string,
): Promise<boolean> {
  const owner = await lockOrganization(client, organizationId);
  if (owner === accountId) return true;
  const member = await client.query(
    'SELECT 1 FROM organization_members WHERE organization_id = $1 AND account_id = $2',
    [organizationId, accountId],
  );
  if (!member.rowCount) throw new AccountFailure('organization-denied');
  return false;
}

export async function vaultAccessView(
  client: PoolClient,
  accountId: string,
  action: VaultAccessAction,
): Promise<VaultAccessView> {
  const { organizationId } = action;
  const owner = await organizationOwner(client, organizationId, accountId);
  if (action.kind !== 'list' && !owner) throw new AccountFailure('organization-denied');
  let selected: string | undefined;
  if (action.kind === 'create') {
    selected = randomUUID();
    const count = await client.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM organization_vault_catalog WHERE organization_id = $1',
      [organizationId],
    );
    if (count.rows[0]!.count >= 50) throw new AccountFailure('organization-limit');
    const inserted = await client.query(
      `INSERT INTO organization_vault_catalog (id, organization_id, name)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [selected, organizationId, action.name],
    );
    if (!inserted.rowCount) throw new AccountFailure('organization-vault-name');
  } else if (action.kind !== 'list') {
    selected = action.vaultId;
    const present = await client.query(
      'SELECT 1 FROM organization_vault_catalog WHERE organization_id = $1 AND id = $2',
      [organizationId, selected],
    );
    if (!present.rowCount) throw new AccountFailure('organization-denied');
    if (action.kind === 'visibility') {
      await client.query(
        'UPDATE organization_vault_catalog SET all_members = $3 WHERE organization_id = $1 AND id = $2',
        [organizationId, selected, action.allMembers],
      );
    }
    if (action.kind === 'grant') {
      const { memberId, grant } = action;
      if (memberId === accountId) throw new AccountFailure('organization-denied');
      if (grant === null) {
        await client.query(
          'DELETE FROM organization_vault_grants WHERE organization_id = $1 AND vault_id = $2 AND account_id = $3',
          [organizationId, selected, memberId],
        );
      } else {
        const added = await client.query(
          `INSERT INTO organization_vault_grants (organization_id, vault_id, account_id, access)
           SELECT $1::uuid, $2::uuid, $3::uuid, $4::text
           WHERE EXISTS (SELECT 1 FROM organization_members WHERE organization_id = $1 AND account_id = $3)
           ON CONFLICT (organization_id, vault_id, account_id) DO UPDATE SET access = excluded.access`,
          [organizationId, selected, memberId, grant],
        );
        if (!added.rowCount) throw new AccountFailure('organization-member-missing');
      }
    }
  }

  const rows = await client.query<VaultDescriptor>(
    `SELECT v.id, v.name, v.all_members AS "allMembers",
       CASE WHEN $3::boolean THEN 'owner' ELSE coalesce(g.access, 'reader') END AS access
     FROM organization_vault_catalog v LEFT JOIN organization_vault_grants g
       ON g.organization_id = v.organization_id AND g.vault_id = v.id AND g.account_id = $2
     WHERE v.organization_id = $1 AND ($3 OR v.all_members OR g.access IS NOT NULL)
     ORDER BY (v.id = v.organization_id) DESC, v.name, v.id`,
    [organizationId, accountId, owner],
  );
  const result: VaultAccessView = { vaults: rows.rows };
  if (selected) {
    const members = await client.query<VaultAdministration['members'][number]>(
      `SELECT a.id, a.email, g.access AS grant
       FROM organization_members m JOIN accounts a ON a.id = m.account_id
       LEFT JOIN organization_vault_grants g ON g.organization_id = m.organization_id
         AND g.account_id = m.account_id AND g.vault_id = $2
       WHERE m.organization_id = $1 AND a.id <> $3 ORDER BY a.email`,
      [organizationId, selected, accountId],
    );
    result.administration = { vaultId: selected, members: members.rows };
  }
  return result;
}

export async function requireVaultAccess(
  client: PoolClient,
  accountId: string,
  organizationId: string,
  vaultId: string,
): Promise<VaultAccess> {
  const owner = await organizationOwner(client, organizationId, accountId);
  const result = await client.query<{ all_members: boolean; access: VaultGrant | null }>(
    `SELECT v.all_members, g.access FROM organization_vault_catalog v
     LEFT JOIN organization_vault_grants g ON g.organization_id = v.organization_id
       AND g.vault_id = v.id AND g.account_id = $3
     WHERE v.organization_id = $1 AND v.id = $2`,
    [organizationId, vaultId, accountId],
  );
  const vault = result.rows[0];
  if (!vault) throw new AccountFailure('organization-vault-denied');
  const access = owner ? 'owner' : (vault.access ?? (vault.all_members ? 'reader' : undefined));
  if (!access) throw new AccountFailure('organization-vault-denied');
  return access;
}

export async function vaultSnapshot(
  client: PoolClient,
  accountId: string,
  organizationId: string,
  vaultId: string,
  write?: OrganizationVaultWrite,
): Promise<
  (OrganizationVaultSnapshot & { vaultId: string; access: VaultAccess }) | { revision: number }
> {
  const access = await requireVaultAccess(client, accountId, organizationId, vaultId);
  if (write) {
    if (access === 'reader') throw new AccountFailure('organization-vault-denied');
    const { expectedRevision, envelope, writeProof } = write;
    const hash = createHash('sha256').update(writeProof).digest('hex');
    const revision = expectedRevision + 1;
    const saved =
      expectedRevision === 0
        ? await client.query(
            `INSERT INTO organization_vaults (organization_id, vault_id, revision, envelope, write_hash)
           VALUES ($1, $2, 1, $3, $4) ON CONFLICT (organization_id, vault_id) DO NOTHING`,
            [organizationId, vaultId, JSON.stringify(envelope), hash],
          )
        : await client.query(
            `UPDATE organization_vaults SET revision = $3, envelope = $4
           WHERE organization_id = $1 AND vault_id = $2 AND revision = $5 AND write_hash = $6`,
            [organizationId, vaultId, revision, JSON.stringify(envelope), expectedRevision, hash],
          );
    if (!saved.rowCount) throw new AccountFailure('sync-conflict');
    return { revision };
  }
  const data = await client.query<Pick<OrganizationVaultSnapshot, 'revision' | 'envelope'>>(
    'SELECT revision, envelope FROM organization_vaults WHERE organization_id = $1 AND vault_id = $2',
    [organizationId, vaultId],
  );
  return { organizationId, vaultId, access, ...(data.rows[0] ?? { revision: 0, envelope: null }) };
}
