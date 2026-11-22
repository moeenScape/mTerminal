import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Pool } from 'pg';
import {
  accountRoutes,
  normalizeAccountEmail,
  validAccountPassword,
} from '../../../packages/shared/accounts.ts';
import { createAccounts } from '../src/accounts.ts';
import { migrateAccounts } from '../src/database.ts';
import { createAccountServer } from '../src/http.ts';

test('normalizes one email address and bounds account passwords', () => {
  assert.equal(normalizeAccountEmail(' User+ops@Example.com '), 'user+ops@example.com');
  assert.equal(normalizeAccountEmail('user@example.com\r\nother@example.com'), undefined);
  assert.equal(normalizeAccountEmail('user@invalid-.example'), undefined);
  assert.ok(validAccountPassword('a suitable test password'));
  assert.equal(validAccountPassword('short'), false);
  assert.equal(validAccountPassword('a'.repeat(129)), false);
});

test(
  'verifies email once, replaces per-device sessions, and isolates sign-out',
  {
    skip:
      !process.env.MTERMINAL_TEST_DATABASE_URL &&
      'Set MTERMINAL_TEST_DATABASE_URL for PostgreSQL integration.',
  },
  async () => {
    const connectionString = process.env.MTERMINAL_TEST_DATABASE_URL;
    assert.ok(connectionString);
    const schema = 'account_test_' + randomUUID().replaceAll('-', '');
    const admin = new Pool({ connectionString });
    const pool = new Pool({ connectionString, options: `-c search_path=${schema}` });
    const codes: string[] = [];
    const server = createAccountServer(
      createAccounts(pool, async (_email, code) => {
        codes.push(code);
      }),
    );
    try {
      await admin.query(`CREATE SCHEMA ${schema}`);
      await migrateAccounts(pool);
      await migrateAccounts(pool);
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      const call = (path: string, method: string, body?: object, token?: string) =>
        fetch(`http://127.0.0.1:${address.port}${path}`, {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
      const email = 'tester@example.com';
      const first = {
        email,
        password: 'a suitable test password',
        deviceId: randomUUID(),
        deviceName: 'First device',
      };
      const second = { ...first, deviceId: randomUUID(), deviceName: 'Second device' };
      assert.equal((await call(accountRoutes.register, 'POST', { email })).status, 202);
      assert.equal((await call(accountRoutes.register, 'POST', { email })).status, 202);
      assert.equal(codes.length, 1);
      assert.equal((await call(accountRoutes.signIn, 'POST', first)).status, 401);
      const verification = { ...first, code: codes[0] };
      const responses = await Promise.all([
        call(accountRoutes.verify, 'POST', verification),
        call(accountRoutes.verify, 'POST', verification),
      ]);
      assert.deepEqual(responses.map((response) => response.status).sort(), [200, 400]);
      const { token } = (await responses.find((response) => response.ok)!.json()) as {
        token: string;
      };
      assert.equal((await call(accountRoutes.register, 'POST', { email })).status, 202);
      assert.equal(codes.length, 1);
      assert.equal(
        (
          await call(accountRoutes.signIn, 'POST', {
            ...first,
            password: 'a different valid password',
          })
        ).status,
        401,
      );
      const secondSession = await call(accountRoutes.signIn, 'POST', second);
      assert.equal(secondSession.status, 200);
      const secondToken = ((await secondSession.json()) as { token: string }).token;
      const renewed = await call(accountRoutes.signIn, 'POST', first);
      assert.equal(renewed.status, 200);
      const renewedToken = ((await renewed.json()) as { token: string }).token;
      assert.equal((await call(accountRoutes.session, 'GET', undefined, token)).status, 401);
      const session = await call(accountRoutes.session, 'GET', undefined, renewedToken);
      assert.equal(session.status, 200);
      const view = (await session.json()) as {
        currentDeviceId: string;
        devices: unknown[];
        sessions: unknown[];
      };
      assert.equal(view.currentDeviceId, first.deviceId);
      assert.equal(view.devices.length, 2);
      assert.equal(view.sessions.length, 2);
      assert.equal(
        (await call(accountRoutes.session, 'DELETE', undefined, renewedToken)).status,
        200,
      );
      assert.equal((await call(accountRoutes.session, 'GET', undefined, renewedToken)).status, 401);
      assert.equal((await call(accountRoutes.session, 'GET', undefined, secondToken)).status, 200);
      await pool.query("UPDATE account_sessions SET expires_at = now() - interval '1 second'");
      assert.equal((await call(accountRoutes.session, 'GET', undefined, secondToken)).status, 401);
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
