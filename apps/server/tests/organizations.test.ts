import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { Pool } from 'pg';
import { accountRoutes } from '../../../packages/shared/accounts.ts';
import {
  ORGANIZATION_ROUTE,
  type OrganizationAction,
  type OrganizationView,
} from '../../../packages/shared/organizations.ts';
import { organizationVaultRoute } from '../../../packages/shared/organization-vault.ts';
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
