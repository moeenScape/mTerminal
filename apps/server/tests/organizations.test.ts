import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { test } from 'node:test';
import { Pool } from 'pg';
import { accountRoutes } from '../../../packages/shared/accounts.ts';
import {
  ORGANIZATION_ROUTE,
  type OrganizationAction,
  type OrganizationView,
} from '../../../packages/shared/organizations.ts';
import {
  ORGANIZATION_VAULTS_ROUTE,
  organizationVaultRoute,
  type VaultAccessAction,
  type VaultAccessView,
} from '../../../packages/shared/organization-vault.ts';
import { SHARED_LOGS_ROUTE } from '../../../packages/shared/shared-logs.ts';
import { purgeSharedLogs } from '../src/shared-logs.ts';
import { WORKSPACE_SYNC_ROUTE } from '../../../packages/shared/workspace-sync.ts';
import { createAccounts } from '../src/accounts.ts';
import { migrateAccounts } from '../src/database.ts';
import { createAccountServer } from '../src/http.ts';

test(
  'enforces organization ownership, verified-email invitations, and immediate offboarding',
  { skip: !process.env.MTERMINAL_TEST_DATABASE_URL && 'Set MTERMINAL_TEST_DATABASE_URL.' },
  async () => {
    const connectionString = process.env.MTERMINAL_TEST_DATABASE_URL;
    assert.ok(connectionString);
    const schema = 'org_test_' + randomUUID().replaceAll('-', '');
    const admin = new Pool({ connectionString });
    const pool = new Pool({ connectionString, options: `-c search_path=${schema}` });
    const mail = new Map<string, string>();
    const server = createAccountServer(
      createAccounts(
        pool,
        async (email, code) => {
          mail.set(email, code);
        },
        Buffer.alloc(32, 17),
      ),
    );
    try {
      await admin.query(`CREATE SCHEMA ${schema}`);
      await migrateAccounts(pool);
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      const base = `http://127.0.0.1:${address.port}`;
      const call = (path: string, method: string, token?: string, body?: object) =>
        fetch(base + path, {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
      const signUp = async (email: string): Promise<string> => {
        assert.equal(
          (await call(accountRoutes.register, 'POST', undefined, { email })).status,
          202,
        );
        const code = mail.get(email);
        assert.ok(code);
        const response = await call(accountRoutes.verify, 'POST', undefined, {
          email,
          code,
          password: 'a suitable test password',
          deviceId: randomUUID(),
          deviceName: 'Test desktop',
        });
        assert.equal(response.status, 200);
        return ((await response.json()) as { token: string }).token;
      };
      const request = (token: string | undefined, body: OrganizationAction) =>
        call(ORGANIZATION_ROUTE, 'POST', token, body);
      const view = async (
        token: string,
        body: OrganizationAction = { kind: 'status' },
      ): Promise<OrganizationView> => {
        const response = await request(token, body);
        assert.equal(response.status, 200);
        return (await response.json()) as OrganizationView;
      };
      const accessRequest = (token: string, action: VaultAccessAction) =>
        call(ORGANIZATION_VAULTS_ROUTE, 'POST', token, action);
      const accessView = async (
        token: string,
        action: VaultAccessAction,
      ): Promise<VaultAccessView> => {
        const response = await accessRequest(token, action);
        assert.equal(response.status, 200);
        return (await response.json()) as VaultAccessView;
      };
      const owner = await signUp('owner@example.com');
      const teammate = await signUp('teammate@example.com');
      const outsider = await signUp('outsider@example.com');

      assert.equal((await request(undefined, { kind: 'status' })).status, 401);
      assert.equal(
        (
          await call(ORGANIZATION_ROUTE, 'POST', owner, {
            kind: 'create',
            name: 'Ops',
            owner: false,
          })
        ).status,
        400,
      );
      const created = await view(owner, { kind: 'create', name: 'Ops' });
      const organizationId = created.organizations[0]?.id;
      const ownerId = created.roster?.members[0]?.id;
      assert.ok(organizationId && ownerId && created.roster?.members[0]?.owner);
      const vault = organizationVaultRoute(organizationId);
      const initial = {
        expectedRevision: 0,
        envelope: {
          version: 1,
          nonce: 'n'.repeat(16),
          tag: 't'.repeat(22),
          ciphertext: 'Y2lwaGVy',
        },
        writeProof: 'p'.repeat(43),
      };
      const empty = await call(vault, 'GET', owner);
      assert.equal(empty.status, 200);
      assert.deepEqual(await empty.json(), { organizationId, revision: 0, envelope: null });
      assert.equal((await call(vault, 'GET')).status, 401);
      assert.equal((await call(vault, 'GET', outsider)).status, 403);
      assert.equal((await call(vault, 'PUT', outsider, initial)).status, 403);
      assert.equal(
        (await call(vault, 'PUT', owner, { ...initial, plaintext: 'rejected' })).status,
        400,
      );
      const saved = await call(vault, 'PUT', owner, initial);
      assert.equal(saved.status, 200);
      assert.deepEqual(await saved.json(), { revision: 1 });
      assert.equal((await call(vault, 'PUT', owner, initial)).status, 409);
      assert.equal(
        (
          await call(vault, 'PUT', owner, {
            ...initial,
            expectedRevision: 1,
            writeProof: 'q'.repeat(43),
          })
        ).status,
        409,
      );
      const manage = { kind: 'manage', organizationId } as const;
      const leave = { kind: 'leave', organizationId } as const;
      assert.equal((await request(owner, leave)).status, 409);
      assert.equal((await request(outsider, manage)).status, 403);

      const invite = { kind: 'invite', organizationId, email: 'TEAMMATE@example.com' } as const;
      assert.equal((await request(outsider, invite)).status, 403);
      await view(owner, invite);
      const firstInvite = (await view(teammate)).invitations[0]?.id;
      assert.ok(firstInvite);
      const accept = { kind: 'accept', invitationId: firstInvite } as const;
      assert.deepEqual(await view(outsider), { organizations: [], invitations: [] });
      assert.equal((await request(outsider, accept)).status, 404);
      const otherOrg = (await view(outsider, { kind: 'create', name: 'Other team' }))
        .organizations[0]?.id;
      assert.ok(otherOrg);
      const isolatedVault = await call(organizationVaultRoute(otherOrg), 'GET', outsider);
      assert.equal(isolatedVault.status, 200);
      assert.deepEqual(await isolatedVault.json(), {
        organizationId: otherOrg,
        revision: 0,
        envelope: null,
      });
      assert.equal((await call(vault, 'GET', outsider)).status, 403);

      await view(owner, { kind: 'cancel-invite', organizationId, invitationId: firstInvite });
      assert.equal((await request(teammate, accept)).status, 404);

      await view(owner, invite);
      const expired = (await view(teammate)).invitations[0]?.id;
      assert.ok(expired);
      await pool.query(
        "UPDATE organization_invitations SET expires_at = now() - interval '1 second' WHERE id = $1",
        [expired],
      );
      assert.equal(
        (await request(teammate, { kind: 'accept', invitationId: expired })).status,
        404,
      );

      await view(owner, invite);
      const invitationId = (await view(teammate)).invitations[0]?.id;
      assert.ok(invitationId);
      const accepted = await Promise.all([
        request(teammate, { kind: 'accept', invitationId }),
        request(teammate, { kind: 'accept', invitationId }),
      ]);
      assert.deepEqual(accepted.map(({ status }) => status).sort(), [200, 404]);
      assert.deepEqual((await view(teammate)).organizations, [
        { id: organizationId, name: 'Ops', owner: false },
      ]);
      assert.equal((await request(teammate, manage)).status, 403);
      assert.equal((await request(owner, invite)).status, 409);

      const listVaults = { kind: 'list', organizationId } as const;
      assert.equal((await accessRequest(outsider, listVaults)).status, 403);
      assert.deepEqual((await accessView(teammate, listVaults)).vaults, []);
      assert.equal((await call(vault, 'GET', teammate)).status, 403);
      await accessView(owner, {
        kind: 'visibility',
        organizationId,
        vaultId: organizationId,
        allMembers: true,
      });
      const privateVaults = await accessView(owner, {
        kind: 'create',
        organizationId,
        name: 'Private operations',
      });
      const privateVaultId = privateVaults.administration?.vaultId;
      const teammateId = privateVaults.administration?.members[0]?.id;
      assert.ok(privateVaultId && teammateId);
      const privateRoute = organizationVaultRoute(organizationId, privateVaultId);
      assert.equal((await call(privateRoute, 'GET', teammate)).status, 403);
      assert.equal(
        (await call(organizationVaultRoute(otherOrg, privateVaultId), 'GET', outsider)).status,
        403,
      );
      assert.deepEqual(
        (await accessView(teammate, listVaults)).vaults.map((item) => item.id),
        [organizationId],
      );
      const grant = {
        kind: 'grant',
        organizationId,
        vaultId: privateVaultId,
        memberId: teammateId,
      } as const;
      assert.equal((await accessRequest(teammate, { ...grant, grant: 'editor' })).status, 403);
      await accessView(owner, { ...grant, grant: 'reader' });
      assert.equal((await call(privateRoute, 'GET', teammate)).status, 200);
      assert.equal((await call(privateRoute, 'PUT', teammate, initial)).status, 403);
      await accessView(owner, { ...grant, grant: 'editor' });
      const editorWrite = await call(privateRoute, 'PUT', teammate, initial);
      assert.equal(editorWrite.status, 200);
      assert.deepEqual(await editorWrite.json(), { revision: 1 });
      const logTarget = { organizationId, vaultId: privateVaultId, logId: randomUUID() };
      const share = {
        ...logTarget,
        kind: 'share',
        label: initial.envelope,
        transcript: initial.envelope,
        writeProof: initial.writeProof,
      };
      const logRequest = (bearer: string | undefined, body: object) =>
        call(SHARED_LOGS_ROUTE, 'POST', bearer, body);
      const sharedLog = (kind: 'read' | 'remove') => ({ ...logTarget, kind });
      const listLogs = { kind: 'list', organizationId, vaultId: privateVaultId };
      assert.equal((await logRequest(undefined, listLogs)).status, 401);
      assert.equal((await logRequest(outsider, listLogs)).status, 403);
      assert.equal((await logRequest(owner, { ...share, plaintext: 'do not store' })).status, 400);
      assert.equal((await logRequest(owner, { ...share, writeProof: 'q'.repeat(43) })).status, 409);
      assert.equal((await logRequest(teammate, share)).status, 200);
      assert.equal((await logRequest(owner, share)).status, 200);
      const listed = await logRequest(owner, listLogs);
      assert.equal(listed.status, 200);
      const { logs } = (await listed.json()) as {
        logs: { id: string; sharedAt: string; expiresAt: string }[];
      };
      assert.equal(logs.length, 1);
      assert.equal(logs[0]?.id, logTarget.logId);
      assert.equal(Date.parse(logs[0]!.expiresAt) - Date.parse(logs[0]!.sharedAt), 30 * 86400000);
      const annotate = {
        ...logTarget,
        kind: 'annotate',
        annotationId: randomUUID(),
        envelope: initial.envelope,
        writeProof: initial.writeProof,
      };
      assert.equal(
        (await logRequest(teammate, { ...annotate, author: 'spoof@example.com' })).status,
        400,
      );
      assert.equal((await logRequest(teammate, annotate)).status, 200);
      const retried = await logRequest(teammate, annotate);
      const annotated = (await retried.json()) as {
        log: { annotations: { author: string; id: string }[] };
      };
      assert.equal(annotated.log.annotations.length, 1);
      assert.equal(annotated.log.annotations[0]?.id, annotate.annotationId);
      assert.equal(annotated.log.annotations[0]?.author, 'teammate@example.com');
      assert.equal((await logRequest(teammate, sharedLog('remove'))).status, 403);
      await accessView(owner, { ...grant, grant: 'reader' });
      assert.equal((await logRequest(teammate, sharedLog('read'))).status, 200);
      assert.equal((await logRequest(teammate, annotate)).status, 403);
      assert.equal((await logRequest(teammate, share)).status, 403);
      await pool.query(
        'UPDATE organization_shared_logs SET expires_at = now() WHERE organization_id = $1 AND vault_id = $2 AND id = $3',
        [organizationId, privateVaultId, logTarget.logId],
      );
      assert.equal((await logRequest(owner, sharedLog('read'))).status, 404);
      const expiredList = await logRequest(owner, listLogs);
      assert.deepEqual(await expiredList.json(), { logs: [] });
      await purgeSharedLogs(pool);
      const purged = await pool.query(
        'SELECT 1 FROM organization_log_annotations WHERE log_id = $1',
        [logTarget.logId],
      );
      assert.equal(purged.rowCount, 0);
      const secondLog = { ...share, logId: randomUUID() };
      assert.equal((await logRequest(owner, secondLog)).status, 200);
      assert.equal(
        (await logRequest(owner, { ...logTarget, logId: secondLog.logId, kind: 'remove' })).status,
        200,
      );
      assert.equal(
        (await logRequest(owner, { ...logTarget, logId: secondLog.logId, kind: 'read' })).status,
        404,
      );
      await accessView(owner, { ...grant, grant: null });
      assert.equal((await logRequest(teammate, listLogs)).status, 403);
      assert.equal((await call(privateRoute, 'GET', teammate)).status, 403);
      assert.equal(
        (await call(privateRoute, 'PUT', teammate, { ...initial, expectedRevision: 1 })).status,
        403,
      );
      assert.equal(
        (await call(organizationVaultRoute(organizationId, organizationId), 'GET', owner)).status,
        200,
      );
      const shared = await call(vault, 'GET', teammate);
      assert.equal(shared.status, 200);
      assert.deepEqual(await shared.json(), {
        organizationId,
        revision: 1,
        envelope: initial.envelope,
      });
      const update = { ...initial, expectedRevision: 1 };
      assert.equal((await call(vault, 'PUT', teammate, update)).status, 403);
      const memberId = (await view(owner, manage)).roster?.members.find(
        (member) => !member.owner,
      )?.id;
      assert.ok(memberId);
      const transfer = { kind: 'transfer', organizationId, memberId } as const;
      assert.equal((await request(teammate, transfer)).status, 403);
      const transferred = await view(owner, transfer);
      assert.equal(transferred.organizations[0]?.owner, false);
      assert.equal(transferred.roster, undefined);
      assert.equal((await request(owner, manage)).status, 403);
      assert.equal((await request(teammate, leave)).status, 409);
      assert.equal((await call(vault, 'PUT', owner, update)).status, 403);
      const ownUpdate = await call(vault, 'PUT', teammate, update);
      assert.equal(ownUpdate.status, 200);
      assert.deepEqual(await ownUpdate.json(), { revision: 2 });
      await accessView(teammate, { ...grant, memberId: ownerId, grant: 'editor' });
      const removed = await view(teammate, { kind: 'remove', organizationId, memberId: ownerId });
      assert.equal(removed.roster?.members.length, 1);
      assert.deepEqual((await view(owner)).organizations, []);
      assert.equal((await request(owner, manage)).status, 403);
      assert.equal((await call(vault, 'GET', owner)).status, 403);
      assert.equal((await call(WORKSPACE_SYNC_ROUTE, 'GET', owner)).status, 200);

      await view(teammate, { ...invite, email: 'owner@example.com' });
      const returningInvite = (await view(owner)).invitations[0]?.id;
      assert.ok(returningInvite);
      await view(owner, { kind: 'decline', invitationId: returningInvite });
      assert.deepEqual((await view(owner)).invitations, []);
      await view(teammate, { ...invite, email: 'owner@example.com' });
      const rejoin = (await view(owner)).invitations[0]?.id;
      assert.ok(rejoin);
      await view(owner, { kind: 'accept', invitationId: rejoin });
      assert.equal((await call(privateRoute, 'GET', owner)).status, 403);
      assert.deepEqual((await view(owner, leave)).organizations, []);
      assert.equal((await call(accountRoutes.session, 'DELETE', teammate)).status, 200);
      assert.equal((await call(vault, 'GET', teammate)).status, 401);
      assert.equal((await request(teammate, manage)).status, 401);
    } finally {
      if (server.listening)
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      await pool.end();
      try {
        await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      } finally {
        await admin.end();
      }
    }
  },
);

test(
  'migrates a 007 vault without changing its ciphertext, revision, proof or legacy access',
  { skip: !process.env.MTERMINAL_TEST_DATABASE_URL && 'Set MTERMINAL_TEST_DATABASE_URL.' },
  async () => {
    const connectionString = process.env.MTERMINAL_TEST_DATABASE_URL;
    assert.ok(connectionString);
    const schema = 'vault_upgrade_' + randomUUID().replaceAll('-', '');
    const admin = new Pool({ connectionString });
    const pool = new Pool({ connectionString, options: `-c search_path=${schema}` });
    try {
      await admin.query(`CREATE SCHEMA ${schema}`);
      const directory = new URL('../migrations/', import.meta.url);
      const original = (await readdir(directory))
        .filter((file) => /^00[1-7]_.*\.sql$/.test(file))
        .sort();
      assert.equal(original.length, 7);
      await pool.query('CREATE TABLE mterminal_migrations (version integer PRIMARY KEY)');
      for (const [index, file] of original.entries()) {
        await pool.query(await readFile(new URL(file, directory), 'utf8'));
        await pool.query('INSERT INTO mterminal_migrations VALUES ($1)', [index + 1]);
      }
      const owner = randomUUID();
      const organizationId = randomUUID();
      await pool.query('INSERT INTO accounts (id,email,password_hash) VALUES ($1,$2,$3)', [
        owner,
        'owner@example.com',
        'fixture',
      ]);
      const envelope = { version: 1, ciphertext: 'existing-encrypted-bytes' };
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          'INSERT INTO organizations (id,name,owner_account_id) VALUES ($1,$2,$3)',
          [organizationId, 'Legacy team', owner],
        );
        await client.query(
          'INSERT INTO organization_members (organization_id,account_id) VALUES ($1,$2)',
          [organizationId, owner],
        );
        await client.query(
          'INSERT INTO organization_vaults (organization_id,revision,write_hash,envelope) VALUES ($1,4,$2,$3)',
          [organizationId, 'a'.repeat(64), JSON.stringify(envelope)],
        );
        await client.query('COMMIT');
      } finally {
        client.release();
      }
      await migrateAccounts(pool);
      await migrateAccounts(pool);
      const migrated = await pool.query(
        `SELECT v.id, v.all_members, d.revision, d.write_hash, d.envelope
         FROM organization_vault_catalog v JOIN organization_vaults d
         ON d.organization_id = v.organization_id AND d.vault_id = v.id`,
      );
      assert.deepEqual(migrated.rows, [
        {
          id: organizationId,
          all_members: true,
          revision: 4,
          write_hash: 'a'.repeat(64),
          envelope,
        },
      ]);
    } finally {
      await pool.end();
      try {
        await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      } finally {
        await admin.end();
      }
    }
  },
);
