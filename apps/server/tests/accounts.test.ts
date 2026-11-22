import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Pool } from 'pg';
import { Secret, TOTP } from 'otpauth';
import {
  accountRoutes,
  type AccountSummary,
  normalizeAccountEmail,
  validAccountPassword,
} from '../../../packages/shared/accounts.ts';
import { createAccounts } from '../src/accounts.ts';
import { migrateAccounts } from '../src/database.ts';
import { createAccountServer } from '../src/http.ts';
import { authenticatorStep, openAuthenticator, sealAuthenticator } from '../src/account-mfa.ts';

test('normalizes one email address and bounds account passwords', () => {
  assert.equal(normalizeAccountEmail(' User+ops@Example.com '), 'user+ops@example.com');
  assert.equal(normalizeAccountEmail('user@example.com\r\nother@example.com'), undefined);
  assert.equal(normalizeAccountEmail('user@invalid-.example'), undefined);
  assert.ok(validAccountPassword('a suitable test password'));
  assert.equal(validAccountPassword('short'), false);
  assert.equal(validAccountPassword('a'.repeat(129)), false);
});

test('validates a known authenticator code and binds encrypted secrets to the account', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const key = Buffer.alloc(32, 17);
  assert.equal(authenticatorStep(secret, '287082', 59_000), 1);
  assert.equal(authenticatorStep(secret, '287082', 130_000), undefined);
  const encrypted = sealAuthenticator(key, 'first-account', secret);
  assert.notEqual(encrypted, secret);
  assert.equal(openAuthenticator(key, 'first-account', encrypted), secret);
  assert.throws(() => openAuthenticator(key, 'second-account', encrypted));
});

test(
  'protects registration, authenticator sign-in, recovery, and device sessions',
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
    const resetCodes: string[] = [];
    const server = createAccountServer(
      createAccounts(
        pool,
        async (_email, code, purpose) => {
          (purpose === 'verify' ? codes : resetCodes).push(code);
        },
        Buffer.alloc(32, 17),
      ),
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

      const protectedUser = { ...first, email: 'protected@example.com', deviceId: randomUUID() };
      const protectionPeer = { ...protectedUser, deviceId: randomUUID() };
      const sessionToken = async (response: Response): Promise<string> => {
        assert.equal(response.status, 200);
        return ((await response.json()) as { token: string }).token;
      };
      const snapshot = async (bearer: string): Promise<AccountSummary> => {
        const response = await call(accountRoutes.session, 'GET', undefined, bearer);
        assert.equal(response.status, 200);
        return (await response.json()) as AccountSummary;
      };
      const protect = (body: object, bearer: string) =>
        call(accountRoutes.protection, 'POST', body, bearer);
      assert.equal(
        (await call(accountRoutes.register, 'POST', { email: protectedUser.email })).status,
        202,
      );
      const owner = await sessionToken(
        await call(accountRoutes.verify, 'POST', { ...protectedUser, code: codes[1] }),
      );
      const peer = await sessionToken(await call(accountRoutes.signIn, 'POST', protectionPeer));
      const peerId = (await snapshot(peer)).currentSessionId;
      const revoke = { kind: 'revoke-session', sessionId: peerId };
      assert.equal((await protect(revoke, secondToken)).status, 404);
      assert.equal((await snapshot(owner)).sessions.length, 2);
      const setup = await protect({ kind: 'start-mfa', password: protectedUser.password }, owner);
      assert.equal(setup.status, 200);
      const { key } = (await setup.json()) as { key: string };
      const otp = new TOTP({ secret: Secret.fromBase32(key) });
      const factor = otp.generate();
      const enable = { kind: 'enable-mfa', factor };
      assert.equal((await protect(enable, peer)).status, 409);
      const enabled = await protect(enable, owner);
      assert.equal(enabled.status, 200);
      const { recoveryCodes } = (await enabled.json()) as { recoveryCodes: string[] };
      assert.equal(recoveryCodes.length, 8);
      assert.equal((await snapshot(owner)).mfaEnabled, true);
      assert.equal((await call(accountRoutes.session, 'GET', undefined, peer)).status, 401);
      const noFactor = await call(accountRoutes.signIn, 'POST', protectedUser);
      assert.equal(noFactor.status, 401);
      assert.deepEqual(await noFactor.json(), { code: 'mfa-required' });
      const replayed = await call(accountRoutes.signIn, 'POST', { ...protectedUser, factor });
      assert.equal(replayed.status, 401);
      assert.deepEqual(await replayed.json(), { code: 'invalid-factor' });
      const nextOtp = otp.generate({ timestamp: Date.now() + 30_000 });
      const otpPeer = await sessionToken(
        await call(accountRoutes.signIn, 'POST', { ...protectionPeer, factor: nextOtp }),
      );
      assert.equal(
        (
          await protect(
            { kind: 'revoke-session', sessionId: (await snapshot(otpPeer)).currentSessionId },
            owner,
          )
        ).status,
        200,
      );
      assert.equal((await call(accountRoutes.session, 'GET', undefined, otpPeer)).status, 401);
      const backupPeer = await sessionToken(
        await call(accountRoutes.signIn, 'POST', { ...protectionPeer, factor: recoveryCodes[0] }),
      );
      const reusedBackup = await call(accountRoutes.signIn, 'POST', {
        ...protectionPeer,
        factor: recoveryCodes[0],
      });
      assert.equal(reusedBackup.status, 401);
      assert.deepEqual(await reusedBackup.json(), { code: 'invalid-factor' });

      assert.equal(
        (await call(accountRoutes.recover, 'POST', { email: protectedUser.email })).status,
        202,
      );
      assert.equal(
        (await call(accountRoutes.recover, 'POST', { email: 'unknown@example.com' })).status,
        202,
      );
      assert.equal(resetCodes.length, 1);
      const replacement = { ...protectedUser, password: 'a replacement test password' };
      const reset = { ...replacement, code: resetCodes[0] };
      assert.equal((await call(accountRoutes.reset, 'POST', reset)).status, 401);
      assert.equal(
        (await call(accountRoutes.reset, 'POST', { ...reset, factor: recoveryCodes[1] })).status,
        200,
      );
      assert.equal(
        (await call(accountRoutes.reset, 'POST', { ...reset, factor: recoveryCodes[2] })).status,
        400,
      );
      assert.equal((await call(accountRoutes.session, 'GET', undefined, owner)).status, 401);
      assert.equal((await call(accountRoutes.session, 'GET', undefined, backupPeer)).status, 401);
      assert.equal(
        (await call(accountRoutes.signIn, 'POST', { ...protectedUser, factor: recoveryCodes[2] }))
          .status,
        401,
      );
      const recovered = await sessionToken(
        await call(accountRoutes.signIn, 'POST', { ...replacement, factor: recoveryCodes[2] }),
      );
      const limited = await call(accountRoutes.signIn, 'POST', {
        ...replacement,
        factor: recoveryCodes[3],
      });
      assert.equal(limited.status, 429);
      assert.equal(limited.headers.get('retry-after'), '60');
      assert.equal(
        (
          await protect(
            { kind: 'disable-mfa', password: replacement.password, factor: recoveryCodes[3] },
            recovered,
          )
        ).status,
        200,
      );
      assert.equal((await snapshot(recovered)).mfaEnabled, false);

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
