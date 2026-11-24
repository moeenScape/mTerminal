import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, expect, test, type ElectronApplication } from '@playwright/test';
import { ADMINISTRATIVE_EVENTS_ROUTE } from '../../../../packages/shared/administrative-events.ts';
import {
  ORGANIZATION_ROUTE,
  type OrganizationView,
} from '../../../../packages/shared/organizations.ts';
import {
  ORGANIZATION_VAULTS_ROUTE,
  organizationVaultRoute,
  type VaultAccessView,
} from '../../../../packages/shared/organization-vault.ts';
import { SHARED_LOGS_ROUTE } from '../../../../packages/shared/shared-logs.ts';
import { accountRoutes } from '../../../../packages/shared/accounts.ts';
import {
  WORKSPACE_SYNC_ROUTE,
  CREDENTIAL_SYNC_ROUTE,
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
  let deviceName = 'E2E machine';
  const organizationId = '05e9f162-d3cd-4c8f-a70a-2323a1751a9b';
  const vaultRoute = organizationVaultRoute(organizationId, organizationId);
  const extraVaultId = 'f5ad7e42-2977-424e-a083-27968e902146';
  const vaultAccess: VaultAccessView = {
    vaults: [{ id: organizationId, name: 'Shared vault', access: 'owner', allMembers: false }],
  };
  let sharedRevision = 0;
  let sharedEnvelope: ReturnType<typeof parseSyncEnvelope> | null = null;
  let sharedBody = '';
  const orgView: OrganizationView = { organizations: [], invitations: [] };
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
  let credentialReads = 0;
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    const write = (status: number, data: object) => {
      response.statusCode = status;
      response.end(JSON.stringify(data));
    };
    if (
      request.url === CREDENTIAL_SYNC_ROUTE &&
      request.method === 'GET' &&
      request.headers.authorization === `Bearer ${token}`
    ) {
      credentialReads++;
      return write(200, { accountId: cloud.accountId, revision: 0, envelope: null });
    }
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
    if (
      request.url === accountRoutes.devices &&
      request.method === 'GET' &&
      request.headers.authorization === `Bearer ${token}`
    )
      return write(200, { keys: [] });
    if (request.url === vaultRoute && request.headers.authorization === `Bearer ${token}`) {
      if (request.method === 'GET')
        return write(200, {
          organizationId,
          vaultId: organizationId,
          access: 'owner',
          revision: sharedRevision,
          envelope: sharedEnvelope,
        });
      if (request.method === 'PUT') {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(chunk as Buffer);
        sharedBody = Buffer.concat(chunks).toString('utf8');
        const input = JSON.parse(sharedBody) as Record<string, unknown>;
        const envelope = parseSyncEnvelope(input.envelope);
        if (envelope && input.expectedRevision === sharedRevision) {
          sharedEnvelope = envelope;
          return write(200, { revision: ++sharedRevision });
        }
      }
      return write(409, { code: 'sync-conflict' });
    }
    if (request.method === 'POST') {
      const parts: Buffer[] = [];
      for await (const chunk of request) parts.push(chunk as Buffer);
      const input = JSON.parse(Buffer.concat(parts).toString('utf8')) as Record<string, unknown>;
      if (
        request.url === accountRoutes.devices &&
        request.headers.authorization === `Bearer ${token}` &&
        input.kind === 'rename-device' &&
        input.deviceId === deviceId &&
        typeof input.name === 'string'
      ) {
        deviceName = input.name;
        return write(200, { keys: [] });
      }
      if (
        request.url === ORGANIZATION_ROUTE &&
        request.headers.authorization === `Bearer ${token}`
      ) {
        if (input.kind === 'status')
          return write(200, { organizations: orgView.organizations, invitations: [] });
        if (input.kind === 'create' && input.name === 'Release team') {
          orgView.organizations = [{ id: organizationId, name: input.name, owner: true }];
          orgView.roster = {
            organizationId,
            members: [{ id: cloud.accountId, email, owner: true }],
            invitations: [],
          };
          return write(200, orgView);
        }
        if (
          input.kind === 'invite' &&
          input.organizationId === organizationId &&
          input.email === 'member@example.com' &&
          orgView.roster
        ) {
          orgView.roster.invitations = [
            {
              id: 'b5ed7e42-2977-424e-a083-27968e902146',
              email: input.email,
              expiresAt: '2026-12-01T00:00:00.000Z',
            },
          ];
          return write(200, orgView);
        }
      }
      if (
        request.url === ADMINISTRATIVE_EVENTS_ROUTE &&
        request.headers.authorization === `Bearer ${token}` &&
        input.organizationId === organizationId
      ) {
        return write(200, {
          events: [
            {
              id: '34',
              actorEmail: email,
              occurredAt: '2026-11-24T00:00:00.000Z',
              change: { kind: 'organization-created' },
            },
          ],
          nextBefore: null,
        });
      }
      if (
        request.url === ORGANIZATION_VAULTS_ROUTE &&
        request.headers.authorization === `Bearer ${token}` &&
        input.organizationId === organizationId
      ) {
        if (input.kind === 'list') return write(200, { vaults: vaultAccess.vaults });
        if (input.kind === 'create' && input.name === 'Restricted operations') {
          vaultAccess.vaults.push({
            id: extraVaultId,
            name: input.name,
            access: 'owner',
            allMembers: false,
          });
          vaultAccess.administration = {
            vaultId: extraVaultId,
            members: [
              {
                id: 'dd3ed7e4-2977-424e-a083-27968e902146',
                email: 'member@example.com',
                grant: null,
              },
            ],
          };
          return write(200, vaultAccess);
        }
        if (
          input.kind === 'grant' &&
          input.vaultId === extraVaultId &&
          input.grant === 'editor' &&
          input.memberId === 'dd3ed7e4-2977-424e-a083-27968e902146' &&
          vaultAccess.administration
        ) {
          vaultAccess.administration.members[0]!.grant = 'editor';
          return write(200, vaultAccess);
        }
      }
      if (
        request.url === SHARED_LOGS_ROUTE &&
        request.headers.authorization === `Bearer ${token}` &&
        input.kind === 'list' &&
        input.organizationId === organizationId &&
        input.vaultId === organizationId
      )
        return write(200, { logs: [] });
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
          devices: [{ id: deviceId, name: deviceName, lastSignedInAt: '2026-11-22T00:00:00Z' }],
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
    const organizations = section.getByRole('region', { name: 'Organizations', exact: true });
    await organizations.getByRole('button', { name: 'Show organizations' }).click();
    await organizations.getByLabel('Organization name').fill('Release team');
    await organizations.getByRole('button', { name: 'Create organization', exact: true }).click();
    await expect(organizations).toContainText('Release team · Owner');
    const roster = organizations.getByRole('region', { name: 'Manage Release team' });
    await roster.getByLabel('Account email', { exact: true }).fill('member@example.com');
    await roster.getByRole('button', { name: 'Invite member', exact: true }).click();
    await expect(roster.getByRole('list', { name: 'Outgoing invitations' })).toContainText(
      'member@example.com',
    );
    const audit = roster.getByRole('region', { name: 'Administrative events' });
    await audit.getByRole('button', { name: 'Show administrative events' }).click();
    const history = audit.getByRole('list', { name: 'Event history' });
    await expect(history).toContainText('Created the organization');
    await expect(history).toContainText(email);
    await organizations.getByRole('button', { name: 'Vaults for Release team' }).click();
    const vaults = organizations.getByRole('region', { name: 'Vaults for Release team' });
    await vaults.getByRole('button', { name: 'Show vaults' }).click();
    await vaults.getByLabel('Vault name').fill('Restricted operations');
    await vaults.getByRole('button', { name: 'Create vault' }).click();
    const access = vaults.getByRole('region', { name: 'Access for Restricted operations' });
    await expect(access).toContainText('Members need an explicit grant');
    await access.getByLabel('member@example.com').selectOption('editor');
    await access.getByRole('button', { name: 'Save access for member@example.com' }).click();
    await page
      .getByRole('dialog', { name: 'Change vault access?' })
      .getByRole('button', { name: 'Change access' })
      .click();
    await expect(access.getByLabel('member@example.com')).toHaveValue('editor');
    await vaults.getByRole('button', { name: 'Open Shared vault', exact: true }).click();
    const sharedVault = vaults.getByRole('region', { name: 'Shared vault for Shared vault' });
    await sharedVault.getByRole('button', { name: 'Generate vault key' }).click();
    const sharedKey = sharedVault.getByLabel('Shared vault key');
    await expect(sharedKey).toHaveValue(/^mterminal-org-v1_/);
    await sharedVault.getByRole('button', { name: 'Publish settings' }).click();
    await page
      .getByRole('dialog', { name: 'Publish to Shared vault?' })
      .getByRole('button', { name: 'Publish category' })
      .click();
    await expect(sharedVault).toContainText('Published vault revision 1.');
    expect(sharedBody).not.toContain(await sharedKey.inputValue());
    expect(sharedBody).not.toContain('appearance');
    const sharedLogs = sharedVault.getByRole('region', { name: 'Shared session logs' });
    await sharedLogs.getByRole('button', { name: 'Show shared logs' }).click();
    await expect(sharedLogs).toContainText('No shared recordings are available.');
    const devices = section.getByRole('region', { name: 'Account devices' });
    await devices.getByRole('button', { name: 'Rename E2E machine' }).click();
    await devices.getByLabel('Device name', { exact: true }).fill('Travel laptop');
    await devices.getByRole('button', { name: 'Save name', exact: true }).click();
    await expect(devices).toContainText('Travel laptop (this device)');
    await expect(devices.getByRole('button', { name: 'Retire Travel laptop' })).toHaveCount(0);
    await devices.getByRole('button', { name: 'Show public-key directory' }).click();
    await expect(devices).toContainText('No published public keys.');
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
    const metadataToggle = section.getByRole('checkbox', { name: 'Sync workspace metadata' });
    const credentialToggle = section.getByRole('checkbox', { name: 'Sync saved SSH credentials' });
    await expect(metadataToggle).toBeChecked();
    await expect(credentialToggle).not.toBeChecked();
    await metadataToggle.click();
    await expect(section).toContainText('Workspace metadata sync is paused on this device.');
    const paused = await page.evaluate(async () => {
      try {
        await window.mterminal.syncWorkspace({ kind: 'generate-key' });
        return '';
      } catch (error) {
        return (error as Error).message;
      }
    });
    expect(paused).toContain('Enable this sync category');
    await application.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    });
    await credentialToggle.click();
    await expect(credentialToggle).toBeChecked();
    await expect(metadataToggle).not.toBeChecked();
    await section.getByRole('button', { name: 'Generate first credential sync key' }).click();
    await expect(section.getByLabel('Credential sync key', { exact: true })).toHaveValue(
      /^mterminal-sync-v1_/,
    );
    expect(credentialReads).toBe(1);
    await credentialToggle.click();
    await expect(section.getByRole('region', { name: 'Encrypted credential sync' })).toHaveCount(0);
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
