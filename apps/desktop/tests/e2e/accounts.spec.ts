import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, expect, test, type ElectronApplication } from '@playwright/test';
import { accountRoutes } from '../../../../packages/shared/accounts.ts';
import {
  WORKSPACE_SYNC_ROUTE,
  parseSyncEnvelope,
  type SyncSnapshot,
} from '../../../../packages/shared/workspace-sync.ts';

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
  const cloud: SyncSnapshot = {
    maxEnvelopeVersion: 2,
    accountId: '04e9f162-d3cd-4c8f-a70a-2323a1751a9b',
    revision: 0,
    envelope: null,
  };
  let publishedBody = '';
  let workspaceAvailable = true;
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    const write = (status: number, data: object) => {
      response.statusCode = status;
      response.end(JSON.stringify(data));
    };
    if (
      request.url === WORKSPACE_SYNC_ROUTE &&
      request.headers.authorization === `Bearer ${token}` &&
      !signedOut
    ) {
      if (!workspaceAvailable) return write(503, { code: 'unavailable' });
      if (request.method === 'GET') return write(200, cloud);
      if (request.method === 'PUT') {
        const parts: Buffer[] = [];
        for await (const chunk of request) parts.push(chunk as Buffer);
        publishedBody = Buffer.concat(parts).toString('utf8');
        const input = JSON.parse(publishedBody) as Record<string, unknown>;
        const envelope = parseSyncEnvelope(input.envelope);
        if (envelope && input.expectedRevision === cloud.revision) {
          cloud.envelope = envelope;
          cloud.revision++;
          return write(200, { revision: cloud.revision });
        }
      }
      return write(400, { code: 'sync-format' });
    }
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
          accountId: cloud.accountId,
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
    await page.evaluate(() =>
      window.mterminal.saveHost({
        name: 'F61 local fixture',
        address: 'f61-local.example.test',
        port: 22,
        username: 'operator',
        protocol: 'ssh',
      }),
    );
    await section.getByRole('button', { name: 'Generate first sync key' }).click();
    const syncKey = section.getByLabel('Workspace sync key', { exact: true });
    await expect(syncKey).toHaveValue(/^mterminal-sync-v1_/);
    const generated = await syncKey.inputValue();
    workspaceAvailable = false;
    await section.getByRole('button', { name: 'Publish local records' }).click();
    await expect(section).toContainText(
      'Publication is queued. mTerminal retries while it is open.',
    );
    expect(cloud.revision).toBe(0);
    workspaceAvailable = true;
    await syncKey.fill(generated);
    await section.getByRole('button', { name: 'Retry queued publication' }).click();
    await expect(section).toContainText(
      '1 record published to the encrypted copy. Cloud revision 1.',
    );
    expect(publishedBody).not.toContain(generated);
    expect(publishedBody).not.toContain('f61-local.example.test');
    await syncKey.fill(generated);
    await section.getByRole('button', { name: 'Merge cloud records' }).click();
    await expect(section).toContainText('0 records added to this workspace. Cloud revision 1.');
    await page.evaluate(async () => {
      const saved = (await window.mterminal.listHosts()).find(
        (host) => host.name === 'F61 local fixture',
      );
      if (!saved) throw new Error('Missing synced host.');
      await window.mterminal.saveHost({ ...saved, name: 'F63 reviewed update' }, saved.id);
    });
    await syncKey.fill(generated);
    await section.getByRole('button', { name: 'Review differences' }).click();
    await expect(section.getByText('Review differences at cloud revision 1')).toBeVisible();
    await section.getByRole('checkbox', { name: 'Host · F63 reviewed update' }).check();
    await section.getByRole('button', { name: 'Apply 1 selected' }).click();
    await page
      .getByRole('dialog', { name: 'Apply selected workspace changes?' })
      .getByRole('button', { name: 'Apply changes' })
      .click();
    await expect(section).toContainText('1 selected change applied to the cloud copy.');
    expect(cloud.envelope?.version).toBe(2);
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
