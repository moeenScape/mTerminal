import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type {
  Organization,
  OrganizationAction,
  OrganizationInvitation,
  OrganizationRoster,
  OrganizationView,
} from '../../../packages/shared/organizations.ts';
import { AccountFailure } from './account-failure.ts';

const MEMBERSHIP_LIMIT = 50;
const ROSTER_LIMIT = 100;

async function checkMembershipLimit(client: PoolClient, accountId: string): Promise<void> {
  const count = await client.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM organization_members WHERE account_id = $1',
    [accountId],
  );
  if (count.rows[0]!.count >= MEMBERSHIP_LIMIT) throw new AccountFailure('organization-limit');
}

async function lockOrganization(client: PoolClient, organizationId: string): Promise<string> {
  const org = await client.query<{ owner_account_id: string }>(
    'SELECT owner_account_id FROM organizations WHERE id = $1 FOR UPDATE',
    [organizationId],
  );
  const owner = org.rows[0]?.owner_account_id;
  if (!owner) throw new AccountFailure('organization-denied');
  return owner;
}

async function changeOrganization(
  client: PoolClient,
  account: { id: string; email: string },
  action: OrganizationAction,
): Promise<string | undefined> {
  if (action.kind === 'status') return;
  if (action.kind === 'create') {
    await checkMembershipLimit(client, account.id);
    const id = randomUUID();
    await client.query(
      'INSERT INTO organizations (id, name, owner_account_id) VALUES ($1, $2, $3)',
      [id, action.name, account.id],
    );
    await client.query(
      'INSERT INTO organization_members (organization_id, account_id) VALUES ($1, $2)',
      [id, account.id],
    );
    return id;
  }

  if ('invitationId' in action && !('organizationId' in action)) {
    const invitation = await client.query<{ organization_id: string }>(
      'SELECT organization_id FROM organization_invitations WHERE id = $1 AND email = $2 AND expires_at > now()',
      [action.invitationId, account.email],
    );
    const id = invitation.rows[0]?.organization_id;
    if (!id) throw new AccountFailure('organization-invite-missing');
    await lockOrganization(client, id);
    const consumed = await client.query(
      'DELETE FROM organization_invitations WHERE id = $1 AND email = $2 AND expires_at > clock_timestamp()',
      [action.invitationId, account.email],
    );
    if (!consumed.rowCount) throw new AccountFailure('organization-invite-missing');
    if (action.kind === 'accept') {
      await checkMembershipLimit(client, account.id);
      const added = await client.query(
        `INSERT INTO organization_members (organization_id, account_id)
         SELECT $1::uuid, $2::uuid WHERE (
           SELECT count(*) FROM organization_members WHERE organization_id = $1
         ) < $3`,
        [id, account.id, ROSTER_LIMIT],
      );
      if (!added.rowCount) throw new AccountFailure('organization-limit');
    }
    return;
  }

  const id = action.organizationId.toLowerCase();
  const owner = await lockOrganization(client, id);
  if (action.kind === 'leave') {
    if (owner === account.id) throw new AccountFailure('organization-owner');
    const left = await client.query(
      'DELETE FROM organization_members WHERE organization_id = $1 AND account_id = $2',
      [id, account.id],
    );
    if (!left.rowCount) throw new AccountFailure('organization-denied');
    return;
  }
  if (owner !== account.id) throw new AccountFailure('organization-denied');
  if (action.kind === 'manage') return id;

  if (action.kind === 'invite') {
    const current = await client.query(
      `SELECT 1 FROM organization_members m JOIN accounts a ON a.id = m.account_id
       WHERE m.organization_id = $1 AND a.email = $2`,
      [id, action.email],
    );
    if (current.rowCount) throw new AccountFailure('organization-already-member');
    await client.query(
      'DELETE FROM organization_invitations WHERE organization_id = $1 AND expires_at <= now()',
      [id],
    );
    const saved = await client.query(
      `INSERT INTO organization_invitations (id, organization_id, email, expires_at)
       SELECT $1::uuid, $2::uuid, $3::text, now() + interval '7 days'
       WHERE EXISTS (SELECT 1 FROM organization_invitations WHERE organization_id = $2 AND email = $3)
          OR (SELECT count(*) FROM organization_invitations WHERE organization_id = $2) < $4
       ON CONFLICT (organization_id, email) DO UPDATE
       SET id = excluded.id, expires_at = excluded.expires_at`,
      [randomUUID(), id, action.email, ROSTER_LIMIT],
    );
    if (!saved.rowCount) throw new AccountFailure('organization-limit');
  } else if (action.kind === 'cancel-invite') {
    await client.query(
      'DELETE FROM organization_invitations WHERE organization_id = $1 AND id = $2',
      [id, action.invitationId],
    );
  } else if ('memberId' in action) {
    const memberId = action.memberId.toLowerCase();
    if (memberId === account.id) throw new AccountFailure('organization-owner');
    if (action.kind === 'transfer') {
      const changed = await client.query(
        `UPDATE organizations SET owner_account_id = $2 WHERE id = $1 AND EXISTS (
           SELECT 1 FROM organization_members WHERE organization_id = $1 AND account_id = $2
         )`,
        [id, memberId],
      );
      if (!changed.rowCount) throw new AccountFailure('organization-member-missing');
      return;
    }
    const removed = await client.query(
      'DELETE FROM organization_members WHERE organization_id = $1 AND account_id = $2',
      [id, memberId],
    );
    if (!removed.rowCount) throw new AccountFailure('organization-member-missing');
  }
  return id;
}

export async function organizationView(
  client: PoolClient,
  account: { id: string; email: string },
  action: OrganizationAction,
): Promise<OrganizationView> {
  const id = await changeOrganization(client, account, action);
  const orgs = await client.query<Organization>(
    `SELECT o.id, o.name, o.owner_account_id = $1 AS owner
     FROM organization_members m JOIN organizations o ON o.id = m.organization_id
     WHERE m.account_id = $1 ORDER BY o.name, o.id`,
    [account.id],
  );
  const incoming = await client.query<OrganizationInvitation>(
    `SELECT i.id, o.name AS "organizationName", i.expires_at AS "expiresAt"
     FROM organization_invitations i JOIN organizations o ON o.id = i.organization_id
     WHERE i.email = $1 AND i.expires_at > now()
     ORDER BY i.expires_at, i.id LIMIT 100`,
    [account.email],
  );
  const view: OrganizationView = { organizations: orgs.rows, invitations: incoming.rows };
  if (id) {
    const members = await client.query<OrganizationRoster['members'][number]>(
      `SELECT a.id, a.email, a.id = $2 AS owner
       FROM organization_members m JOIN accounts a ON a.id = m.account_id
       WHERE m.organization_id = $1 ORDER BY owner DESC, a.email`,
      [id, account.id],
    );
    const outgoing = await client.query<OrganizationRoster['invitations'][number]>(
      `SELECT id, email, expires_at AS "expiresAt" FROM organization_invitations
       WHERE organization_id = $1 AND expires_at > now() ORDER BY email`,
      [id],
    );
    view.roster = { organizationId: id, members: members.rows, invitations: outgoing.rows };
  }
  return view;
}
