import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import {
  accountRoutes,
  normalizeAccountEmail,
  validAccountPassword,
  validAccountToken,
  validAccountId,
  validSecondFactor,
  validDeviceLabel,
} from '../../../packages/shared/accounts.ts';
import { AccountFailure, type createAccounts, type ProtectionAction } from './accounts.ts';
import {
  WORKSPACE_SYNC_ROUTE,
  CREDENTIAL_SYNC_ROUTE,
  SYNC_HTTP_LIMIT,
  SYNC_MAX_REVISION,
  parseSyncEnvelope,
  validSyncRevision,
} from '../../../packages/shared/workspace-sync.ts';

import {
  ORGANIZATION_ROUTE,
  parseOrganizationAction,
} from '../../../packages/shared/organizations.ts';

import {
  ORGANIZATION_VAULTS_ROUTE,
  parseVaultAccessAction,
} from '../../../packages/shared/organization-vault.ts';

import { SHARED_LOGS_ROUTE, parseSharedLogRequest } from '../../../packages/shared/shared-logs.ts';

import {
  LIVE_SHARE_ROUTE,
  LIVE_FRAME_LIMIT,
  parseLiveRelayAction,
} from '../../../packages/shared/live-share.ts';

const MAX_BODY = 4096;

function reply(response: ServerResponse, status: number, value: object): void {
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

async function body(
  request: IncomingMessage,
  sync = false,
  limit = sync ? SYNC_HTTP_LIMIT : MAX_BODY,
): Promise<Record<string, unknown>> {
  if (request.headers['content-type']?.split(';', 1)[0]?.trim() !== 'application/json')
    throw new AccountFailure('invalid-input');
  const chunks: Buffer[] = [];
  const sizeError = sync ? 'sync-size' : 'invalid-input';
  if (Number(request.headers['content-length']) > limit) throw new AccountFailure(sizeError);
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const data = chunk as Buffer;
    size += data.length;
    if (size > limit) throw new AccountFailure(sizeError);
    chunks.push(data);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (value && typeof value === 'object' && !Array.isArray(value))
      return value as Record<string, unknown>;
  } catch {
    // Invalid JSON is handled as invalid input.
  }
  throw new AccountFailure('invalid-input');
}

const statuses = {
  'invalid-input': 400,
  'invalid-code': 400,
  'invalid-login': 401,
  'mfa-required': 401,
  'invalid-factor': 401,
  'mfa-state': 409,
  'session-missing': 404,
  'device-missing': 404,
  'device-current': 409,
  'device-retired': 403,
  'device-vault-locked': 409,
  'device-key-invalid': 400,
  'device-directory-full': 409,
  'sync-conflict': 409,
  'sync-record-conflict': 409,
  'sync-key': 400,
  'sync-format': 400,
  'sync-size': 413,
  'sync-empty': 404,
  'sync-exists': 409,
  'sync-queue-empty': 404,
  'sync-queue-storage': 503,
  'sync-account-unverified': 409,
  'sync-review-stale': 409,
  'sync-dependencies': 409,
  'sync-local-protected': 409,
  'sync-version': 409,
  'sync-disabled': 403,
  'sync-preferences-storage': 503,
  'sync-credential-owner': 409,
  'sync-credential-missing': 404,
  'sync-credential-exists': 409,
  'sync-credential-stale': 409,
  'sync-credential-key-exists': 409,
  'sync-vault-locked': 409,
  'sync-vault-unavailable': 503,
  'live-unavailable': 404,
  'live-limit': 409,
  'live-gap': 409,
  'live-output': 409,
  'live-control': 409,
  'live-input-pending': 409,
  'shared-log-missing': 404,
  'shared-log-limit': 409,
  'shared-log-line': 400,
  'shared-log-local': 409,
  'shared-log-key': 409,
  'organization-vault-denied': 403,
  'organization-vault-name': 409,
  'organization-vault-empty': 404,
  'organization-vault-local': 503,
  'organization-snippet-conflict': 409,
  'organization-denied': 403,
  'organization-owner': 409,
  'organization-member-missing': 404,
  'organization-invite-missing': 404,
  'organization-already-member': 409,
  'organization-limit': 409,
  'sign-in-required': 401,
  'rate-limited': 429,
  unavailable: 503,
} as const;

function bearer(request: IncomingMessage): string {
  const header = request.headers.authorization;
  const token = header?.slice('Bearer '.length);
  if (!header?.startsWith('Bearer ') || !validAccountToken(token))
    throw new AccountFailure('sign-in-required');
  return token;
}

function protectionAction(input: Record<string, unknown>): ProtectionAction {
  const { kind, password, factor, sessionId } = input;
  if (kind === 'revoke-session' && validAccountId(sessionId)) return { kind, sessionId };
  if (kind === 'start-mfa' && validAccountPassword(password)) return { kind, password };
  if (kind === 'enable-mfa' && typeof factor === 'string' && /^\d{6}$/.test(factor))
    return { kind, factor };
  if (kind === 'disable-mfa' && validAccountPassword(password) && validSecondFactor(factor))
    return { kind, password, factor };
  throw new AccountFailure('invalid-input');
}

function peerAddress(request: IncomingMessage, trustProxy: boolean): string {
  const direct = request.socket.remoteAddress ?? '';
  const forwarded = direct === '127.0.0.1' && trustProxy ? request.headers['x-real-ip'] : undefined;
  if (trustProxy && (typeof forwarded !== 'string' || !isIP(forwarded)))
    throw new AccountFailure('invalid-input');
  return typeof forwarded === 'string' ? forwarded.toLowerCase() : direct;
}

export function createAccountServer(
  accounts: ReturnType<typeof createAccounts>,
  trustProxy = false,
) {
  let active = 0;
  return createServer(
    { requestTimeout: 10_000, headersTimeout: 10_000, connectionsCheckingInterval: 1000 },
    async (request, response) => {
      let admitted = false;
      try {
        if (
          request.url === accountRoutes.session &&
          (request.method === 'GET' || request.method === 'DELETE')
        ) {
          const token = bearer(request);
          if (request.method === 'GET') return reply(response, 200, await accounts.session(token));
          await accounts.signOut(token);
          return reply(response, 200, {});
        }
        if (
          (request.url === WORKSPACE_SYNC_ROUTE || request.url === CREDENTIAL_SYNC_ROUTE) &&
          (request.method === 'GET' || request.method === 'PUT')
        ) {
          if (active >= 4) throw new AccountFailure('rate-limited');
          active++;
          admitted = true;
          const token = bearer(request);
          const credentials = request.url === CREDENTIAL_SYNC_ROUTE;
          await accounts.rateLimit('sync-peer', peerAddress(request, trustProxy), 30);
          const snapshot = await accounts.workspaceSnapshot(token, credentials);
          if (request.method === 'GET')
            return reply(
              response,
              200,
              credentials ? snapshot : { ...snapshot, maxEnvelopeVersion: 2 },
            );
          const input = await body(request, true);
          const envelope = parseSyncEnvelope(input.envelope);
          const { expectedRevision, writeProof } = input;
          if (
            Object.keys(input).length !== 3 ||
            !envelope ||
            (credentials && envelope.version !== 1) ||
            !validAccountToken(writeProof) ||
            !validSyncRevision(expectedRevision) ||
            expectedRevision >= SYNC_MAX_REVISION
          )
            throw new AccountFailure('sync-format');
          if (snapshot.revision !== expectedRevision) throw new AccountFailure('sync-conflict');
          if (snapshot.envelope && snapshot.envelope.version > envelope.version)
            throw new AccountFailure('sync-version');
          return reply(response, 200, {
            revision: await accounts.saveWorkspaceSnapshot(
              token,
              expectedRevision,
              envelope,
              writeProof,
              credentials,
            ),
          });
        }
        if (
          request.url === accountRoutes.devices &&
          (request.method === 'GET' || request.method === 'POST')
        ) {
          if (active >= 4) throw new AccountFailure('rate-limited');
          active++;
          admitted = true;
          const token = bearer(request);
          await accounts.rateLimit('device-peer', peerAddress(request, trustProxy), 50);
          const action = request.method === 'POST' ? await body(request) : undefined;
          return reply(response, 200, await accounts.deviceDirectory(token, action));
        }
        if (
          (request.method === 'GET' || request.method === 'PUT') &&
          request.url?.startsWith(`${ORGANIZATION_ROUTE}/`) &&
          (request.url.endsWith('/vault') || request.url.includes('/vaults/'))
        ) {
          if (active >= 4) throw new AccountFailure('rate-limited');
          active++;
          admitted = true;
          const [rawOrg, scope, rawVault, ...extra] = request.url
            .slice(ORGANIZATION_ROUTE.length + 1)
            .split('/');
          const legacy = scope === 'vault' && rawVault === undefined;
          const selected = legacy ? rawOrg : rawVault;
          if (
            !validAccountId(rawOrg) ||
            !validAccountId(selected) ||
            (!legacy && scope !== 'vaults') ||
            extra.length
          )
            throw new AccountFailure('invalid-input');
          const organizationId = rawOrg.toLowerCase();
          const vaultId = selected.toLowerCase();
          const token = bearer(request);
          await accounts.rateLimit('organization-vault-peer', peerAddress(request, trustProxy), 30);
          if (request.method === 'GET') {
            const snapshot = await accounts.organizationVault(token, organizationId, vaultId);
            if (legacy && 'envelope' in snapshot)
              return reply(response, 200, {
                organizationId,
                revision: snapshot.revision,
                envelope: snapshot.envelope,
              });
            return reply(response, 200, snapshot);
          }
          const input = await body(request, true);
          const { expectedRevision, writeProof } = input;
          const envelope = parseSyncEnvelope(input.envelope);
          if (
            Object.keys(input).length !== 3 ||
            envelope?.version !== 1 ||
            !validAccountToken(writeProof) ||
            !validSyncRevision(expectedRevision) ||
            expectedRevision >= SYNC_MAX_REVISION
          )
            throw new AccountFailure('sync-format');
          return reply(
            response,
            200,
            await accounts.organizationVault(token, organizationId, vaultId, {
              expectedRevision,
              envelope,
              writeProof,
            }),
          );
        }
        if (request.url === LIVE_SHARE_ROUTE && request.method === 'POST') {
          if (active >= 4) throw new AccountFailure('rate-limited');
          active++;
          admitted = true;
          const token = bearer(request);
          const action = parseLiveRelayAction(await body(request, false, LIVE_FRAME_LIMIT + 1024));
          if (!action) throw new AccountFailure('invalid-input');
          await accounts.rateLimit('live-peer', peerAddress(request, trustProxy), 600);
          return reply(response, 200, await accounts.liveTerminal(token, action));
        }
        if (request.url === SHARED_LOGS_ROUTE && request.method === 'POST') {
          if (active >= 4) throw new AccountFailure('rate-limited');
          active++;
          admitted = true;
          const token = bearer(request);
          await accounts.rateLimit('shared-logs-peer', peerAddress(request, trustProxy), 40);
          const action = parseSharedLogRequest(await body(request, true));
          if (!action) throw new AccountFailure('invalid-input');
          return reply(response, 200, await accounts.sharedLogs(token, action));
        }
        if (request.url === ORGANIZATION_VAULTS_ROUTE && request.method === 'POST') {
          if (active >= 4) throw new AccountFailure('rate-limited');
          active++;
          admitted = true;
          const token = bearer(request);
          await accounts.rateLimit(
            'organization-vault-policy-peer',
            peerAddress(request, trustProxy),
            60,
          );
          const action = parseVaultAccessAction(await body(request));
          if (!action) throw new AccountFailure('invalid-input');
          return reply(response, 200, await accounts.organizationVaultAccess(token, action));
        }
        if (request.url === ORGANIZATION_ROUTE && request.method === 'POST') {
          if (active >= 4) throw new AccountFailure('rate-limited');
          active++;
          admitted = true;
          const token = bearer(request);
          await accounts.rateLimit('organization-peer', peerAddress(request, trustProxy), 60);
          const action = parseOrganizationAction(await body(request));
          if (!action) throw new AccountFailure('invalid-input');
          return reply(response, 200, await accounts.organizations(token, action));
        }
        const { register, verify, signIn, recover, reset, protection } = accountRoutes;
        const path = request.url;
        if (
          request.method !== 'POST' ||
          (path !== register &&
            path !== verify &&
            path !== signIn &&
            path !== recover &&
            path !== reset &&
            path !== protection)
        ) {
          request.resume();
          return reply(response, 404, { code: 'invalid-input' });
        }
        if (active >= 4) throw new AccountFailure('rate-limited');
        active++;
        admitted = true;
        const peer = peerAddress(request, trustProxy);
        await accounts.rateLimit('peer', peer, 50);
        const input = await body(request);
        if (path === protection) {
          const token = bearer(request);
          const action = protectionAction(input);
          await accounts.rateLimit('protection', token, 12);
          return reply(response, 200, await accounts.protect(token, action));
        }
        const email = normalizeAccountEmail(input.email);
        if (!email) throw new AccountFailure('invalid-input');
        if (path === register || path === recover) {
          await accounts.rateLimit(path, email, 3);
          if (path === register) await accounts.register(email);
          else await accounts.recover(email);
          return reply(response, 202, {});
        }
        await accounts.rateLimit(path, email, 8);
        const { password, code, deviceId, deviceName, factor } = input;
        if (!validAccountPassword(password) || (factor !== undefined && !validSecondFactor(factor)))
          throw new AccountFailure('invalid-input');
        if (path === reset) {
          if (!validAccountToken(code)) throw new AccountFailure('invalid-code');
          await accounts.resetPassword(email, code, password, factor);
          return reply(response, 200, {});
        }
        if (!validAccountId(deviceId) || !validDeviceLabel(deviceName))
          throw new AccountFailure('invalid-input');
        const device = { id: deviceId, name: deviceName.trim() };
        if (path === verify) {
          if (!validAccountToken(code)) throw new AccountFailure('invalid-code');
          return reply(response, 200, {
            token: await accounts.verify(email, code, password, device),
          });
        }
        return reply(response, 200, {
          token: await accounts.signIn(email, password, device, factor),
        });
      } catch (error) {
        request.resume();
        const code = error instanceof AccountFailure ? error.code : 'unavailable';
        if (code === 'unavailable') console.error('Account request failed.');
        if (code === 'rate-limited') response.setHeader('Retry-After', '60');
        if (!request.complete) response.setHeader('Connection', 'close');
        if (!response.destroyed) reply(response, statuses[code], { code });
      } finally {
        if (admitted) active--;
      }
    },
  );
}
