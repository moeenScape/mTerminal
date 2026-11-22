import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, expect, test, type ElectronApplication } from '@playwright/test';
import { accountRoutes } from '../../../../packages/shared/accounts.ts';

test('creates an account, enables an authenticator, and signs out from Settings', async () => {
  const email = 'e2e@example.com';
  const code = 'C'.repeat(43);
  const token = 'T'.repeat(43);
  const setupKey = 'A'.repeat(32);
  const recoveryCodes = Array.from({ length: 8 }, (_, index) => String(index).repeat(32));
  let deviceId = '';
  let verified = false;
  let signedOut = false;
  let mfaEnabled = false;
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    const write = (status: number, data: object) => {
      response.statusCode = status;
      response.end(JSON.stringify(data));
    };
    if (request.method === 'POST') {
      const parts: Buffer[] = [];
      for await (const chunk of request) parts.push(chunk as Buffer);
      const input = JSON.parse(Buffer.concat(parts).toString('utf8')) as Record<string, unknown>;
      if (request.url === accountRoutes.register && input.email === email) return write(202, {});
      if (
        request.url === accountRoutes.protection &&
        request.headers.authorization === `Bearer ${token}`
      ) {
        if (input.kind === 'start-mfa' && input.password === 'a long test password')
          return write(200, { key: setupKey });
        if (input.kind === 'enable-mfa' && input.factor === '123456') {
          mfaEnabled = true;
          return write(200, { recoveryCodes });
        }
      }
      if (
        request.url === accountRoutes.verify &&
        input.email === email &&
        input.code === code &&
        input.password === 'a long test password' &&
        typeof input.deviceId === 'string'
      ) {
        deviceId = input.deviceId;
        verified = true;
        return write(200, { token });
      }
    }
    if (
      request.url === accountRoutes.session &&
      request.headers.authorization === `Bearer ${token}` &&
      verified &&
      !signedOut
    ) {
      if (request.method === 'DELETE') {
        signedOut = true;
        return write(200, {});
      }
      if (request.method === 'GET')
        return write(200, {
          email,
          mfaEnabled,
          currentDeviceId: deviceId,
          currentSessionId: 'session',
          devices: [{ id: deviceId, name: 'E2E machine', lastSignedInAt: '2026-11-22T00:00:00Z' }],
          sessions: [
            {
              id: 'session',
              deviceId,
              createdAt: '2026-11-22T00:00:00Z',
              expiresAt: '2026-12-22T00:00:00Z',
            },
          ],
        });
    }
    write(400, { code: 'invalid-input' });
  });
  const userData = await mkdtemp(join(tmpdir(), 'mterminal-account-e2e-'));
  let application: ElectronApplication | undefined;
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing local account service.');
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ELECTRON_RENDERER_URL;
    application = await _electron.launch({
      executablePath: createRequire(import.meta.url)('electron') as string,
      chromiumSandbox: true,
      args: [fileURLToPath(new URL('../../', import.meta.url))],
      env: {
        ...env,
        MTERMINAL_USER_DATA: userData,
        MTERMINAL_ACCOUNT_URL: `http://127.0.0.1:${address.port}`,
      },
    });
    const page = await application.firstWindow();
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name: 'Settings', exact: true })
      .click();
    const section = page.getByRole('region', { name: 'Account', exact: true });
    await section.getByRole('button', { name: 'Create account', exact: true }).click();
    await section.getByLabel('Email', { exact: true }).fill(email);
    await section.getByRole('button', { name: 'Send verification code' }).click();
    await section.getByLabel(/Verification code for/).fill(code);
    await section.getByLabel('Create a password').fill('a long test password');
    await section.getByRole('button', { name: 'Verify and create account' }).click();
    await expect(section).toContainText('E2E machine (this device)');
    await section.getByRole('button', { name: 'Set up authenticator' }).click();
    await section.getByLabel('Current password').fill('a long test password');
    await section.getByRole('button', { name: 'Get setup key' }).click();
    await expect(section).toContainText(setupKey);
    await section.getByLabel('Six-digit authenticator code').fill('123456');
    await section.getByRole('button', { name: 'Enable authenticator', exact: true }).click();
    const recovery = section.getByLabel('Account recovery codes');
    await expect(recovery).toContainText(recoveryCodes[0]!);
    await section.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(recovery).toHaveCount(0);
    const state = JSON.stringify(
      await page.evaluate(() => window.mterminal.account({ kind: 'status' })),
    );
    expect(state).not.toContain(token);
    expect(state).not.toContain(setupKey);
    expect(state).not.toContain(recoveryCodes[0]!);
    await section.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(section.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    expect(signedOut).toBe(true);
  } finally {
    try {
      await application?.close();
    } finally {
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(userData, { recursive: true, force: true });
    }
  }
});
