import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import ssh2 from 'ssh2';
import {
  DEVICE_DIRECTORY_LIMIT,
  SSH_PUBLIC_KEY_LIMIT,
  sshPublicKeyPattern,
  validAccountId,
  validDeviceLabel,
  type AccountSummary,
  type DeviceDirectoryKey,
} from '../../../packages/shared/accounts.ts';
import type { OrganizationAction } from '../../../packages/shared/organizations.ts';
import { AccountFailure } from './account-failure.ts';
import type {
  VaultAccessAction,
  OrganizationVaultWrite,
} from '../../../packages/shared/organization-vault.ts';
import { vaultAccessView, vaultSnapshot } from './vault-access.ts';
import { lockOrganization, organizationView } from './organizations.ts';
import { transaction } from './database.ts';
import type { SyncEnvelope, SyncSnapshot } from '../../../packages/shared/workspace-sync.ts';
import {
  authenticatorStep,
  newAuthenticatorKey,
  openAuthenticator,
  sealAuthenticator,
} from './account-mfa.ts';

export { AccountFailure } from './account-failure.ts';

import type { SharedLogRequest } from '../../../packages/shared/shared-logs.ts';
import { sharedLogs } from './shared-logs.ts';

import { LiveRelay } from './live-share.ts';
import type { LiveRelayAction } from '../../../packages/shared/live-share.ts';

import type { AdministrativeQuery } from '../../../packages/shared/administrative-events.ts';
import { readAdministrativeEvents } from './administrative-events.ts';

const scryptOptions = { N: 32_768, r: 8, p: 3, maxmem: 48 * 1024 * 1024 };
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const makeToken = () => randomBytes(32).toString('base64url');
const dummyHash = `${randomBytes(16).toString('hex')}:${randomBytes(64).toString('hex')}`;

export interface DeviceInput {
  id: string;
  name: string;
}

interface AccountRow {
  id: string;
  email: string;
  password_hash: string;
  mfa_secret: string | null;
  mfa_last_step: string | null;
  mfa_recovery_hashes: string[];
  mfa_pending_secret: string | null;
  mfa_pending_session_id: string | null;
  mfa_pending_valid: boolean | null;
}

const accountFields = `id, email, password_hash, mfa_secret, mfa_last_step, mfa_recovery_hashes,
  mfa_pending_secret, mfa_pending_session_id, mfa_pending_until > now() AS mfa_pending_valid`;

export type ProtectionAction =
  | { kind: 'start-mfa'; password: string }
  | { kind: 'enable-mfa'; factor: string }
  | { kind: 'disable-mfa'; password: string; factor: string }
  | { kind: 'revoke-session'; sessionId: string };

function passwordHash(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, scryptOptions, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

async function createPasswordHash(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${(await passwordHash(password, salt)).toString('hex')}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  return timingSafeEqual(await passwordHash(password, salt!), Buffer.from(hash!, 'hex'));
}

async function lockAccount(client: PoolClient, accountId: string): Promise<AccountRow> {
  const selected = await client.query<AccountRow>(
    `SELECT ${accountFields} FROM accounts WHERE id = $1 FOR UPDATE`,
    [accountId],
  );
  const account = selected.rows[0];
  if (!account) throw new AccountFailure('sign-in-required');
  return account;
}

async function accountForSession(client: PoolClient, token: string) {
  const digest = hashToken(token);
  const selected = await client.query<{ account_id: string }>(
    'SELECT account_id FROM account_sessions WHERE token_hash = $1 AND expires_at > now()',
    [digest],
  );
  const accountId = selected.rows[0]?.account_id;
  if (!accountId) throw new AccountFailure('sign-in-required');
  const account = await lockAccount(client, accountId);
  const session = await client.query<{ id: string; device_id: string }>(
    'SELECT id, device_id FROM account_sessions WHERE token_hash = $1 AND expires_at > now() FOR UPDATE',
    [digest],
  );
  const active = session.rows[0];
  if (!active) throw new AccountFailure('sign-in-required');
  return { account, sessionId: active.id, deviceId: active.device_id };
}

async function startSession(
  client: PoolClient,
  accountId: string,
  device: DeviceInput,
): Promise<string> {
  const token = makeToken();
  const updated = await client.query(
    `INSERT INTO account_devices (account_id, id, name) VALUES ($1, $2, $3)
     ON CONFLICT (account_id, id) DO UPDATE SET last_signed_in_at = now()
     WHERE account_devices.retired_at IS NULL`,
    [accountId, device.id, device.name],
  );
  if (!updated.rowCount) throw new AccountFailure('device-retired');
  await client.query(
    `INSERT INTO account_sessions (id, account_id, device_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, now() + interval '30 days')
     ON CONFLICT (account_id, device_id) DO UPDATE SET
       id = excluded.id, token_hash = excluded.token_hash, created_at = now(), expires_at = excluded.expires_at`,
    [randomUUID(), accountId, device.id, hashToken(token)],
  );
  return token;
}

function publicKeyFingerprint(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > SSH_PUBLIC_KEY_LIMIT ||
    !sshPublicKeyPattern.test(value)
  )
    throw new AccountFailure('device-key-invalid');
  const [type, blob] = value.split(' ');
  const key = ssh2.utils.parseKey(value);
  if (
    key instanceof Error ||
    Array.isArray(key) ||
    key.isPrivateKey() ||
    key.type !== type ||
    key.getPublicSSH().toString('base64') !== blob
  )
    throw new AccountFailure('device-key-invalid');
  return `SHA256:${createHash('sha256').update(key.getPublicSSH()).digest('base64').replace(/=+$/, '')}`;
}

async function changeDeviceDirectory(
  client: PoolClient,
  accountId: string,
  currentDeviceId: string,
  action: Record<string, unknown>,
): Promise<void> {
  const { kind, deviceId, identityId, name, publicKey } = action;
  const fields = Object.keys(action).length;
  if (
    kind === 'publish-device-key' &&
    fields === 4 &&
    validAccountId(identityId) &&
    validDeviceLabel(name)
  ) {
    const fingerprint = publicKeyFingerprint(publicKey);
    const saved = await client.query(
      `INSERT INTO account_device_keys (account_id, device_id, identity_id, name, public_key, fingerprint)
       SELECT $1, $2, $3, $4, $5, $6
       WHERE EXISTS (SELECT 1 FROM account_device_keys WHERE account_id = $1 AND device_id = $2 AND identity_id = $3)
          OR (SELECT count(*) FROM account_device_keys WHERE account_id = $1) < $7
       ON CONFLICT (account_id, device_id, identity_id) DO UPDATE
       SET name = excluded.name, public_key = excluded.public_key, fingerprint = excluded.fingerprint`,
      [
        accountId,
        currentDeviceId,
        identityId,
        name.trim(),
        publicKey,
        fingerprint,
        DEVICE_DIRECTORY_LIMIT,
      ],
    );
    if (!saved.rowCount) throw new AccountFailure('device-directory-full');
    return;
  }
  if (!validAccountId(deviceId)) throw new AccountFailure('invalid-input');
  if (kind === 'remove-directory-key' && fields === 3 && validAccountId(identityId)) {
    await client.query(
      'DELETE FROM account_device_keys WHERE account_id = $1 AND device_id = $2 AND identity_id = $3',
      [accountId, deviceId, identityId],
    );
    return;
  }
  if (kind === 'rename-device' && fields === 3 && validDeviceLabel(name)) {
    const result = await client.query(
      'UPDATE account_devices SET name = $3 WHERE account_id = $1 AND id = $2',
      [accountId, deviceId, name.trim()],
    );
    if (!result.rowCount) throw new AccountFailure('device-missing');
    return;
  }
  if (fields !== 2 || (kind !== 'retire-device' && kind !== 'restore-device'))
    throw new AccountFailure('invalid-input');
  if (deviceId.toLowerCase() === currentDeviceId) throw new AccountFailure('device-current');
  const retiring = kind === 'retire-device';
  const result = await client.query(
    `UPDATE account_devices SET retired_at = ${retiring ? 'now()' : 'NULL'}
     WHERE account_id = $1 AND id = $2 AND retired_at IS ${retiring ? '' : 'NOT '}NULL`,
    [accountId, deviceId],
  );
  if (!result.rowCount) throw new AccountFailure('device-missing');
  if (retiring) {
    await client.query('DELETE FROM account_sessions WHERE account_id = $1 AND device_id = $2', [
      accountId,
      deviceId,
    ]);
    await client.query('DELETE FROM account_device_keys WHERE account_id = $1 AND device_id = $2', [
      accountId,
      deviceId,
    ]);
  }
}

export function createAccounts(
  pool: Pool,
  sendCode: (email: string, code: string, purpose: 'verify' | 'reset') => Promise<void>,
  mfaKey: Buffer,
) {
  if (mfaKey.length !== 32) throw new Error('Invalid account protection key.');
  let nextCleanup = 0;
  const live = new LiveRelay();

  async function consumeFactor(
    client: PoolClient,
    account: AccountRow,
    factor: string | undefined,
  ) {
    if (!account.mfa_secret) return;
    if (!factor) throw new AccountFailure('mfa-required');
    if (factor.length === 32) {
      const hash = hashToken(factor.toLowerCase());
      if (!account.mfa_recovery_hashes.includes(hash)) throw new AccountFailure('invalid-factor');
      await client.query(
        'UPDATE accounts SET mfa_recovery_hashes = array_remove(mfa_recovery_hashes, $2) WHERE id = $1',
        [account.id, hash],
      );
      return;
    }
    const step = authenticatorStep(
      openAuthenticator(mfaKey, account.id, account.mfa_secret),
      factor,
    );
    if (
      step === undefined ||
      (account.mfa_last_step !== null && step <= Number(account.mfa_last_step))
    )
      throw new AccountFailure('invalid-factor');
    await client.query('UPDATE accounts SET mfa_last_step = $2 WHERE id = $1', [account.id, step]);
  }

  async function issueEmailCode(email: string, purpose: 'verify' | 'reset'): Promise<void> {
    const table = purpose === 'verify' ? 'account_verifications' : 'account_password_resets';
    const eligibility = purpose === 'verify' ? 'NOT EXISTS' : 'EXISTS';
    const code = makeToken();
    const digest = hashToken(code);
    const issued = await pool.query(
      `INSERT INTO ${table} (email, token_hash, expires_at)
       SELECT $1, $2, now() + interval '20 minutes' WHERE ${eligibility} (SELECT 1 FROM accounts WHERE email = $1)
       ON CONFLICT (email) DO UPDATE SET token_hash = excluded.token_hash, created_at = now(), expires_at = excluded.expires_at
       WHERE ${table}.created_at <= now() - interval '1 minute'
       RETURNING email`,
      [email, digest],
    );
    if (!issued.rowCount) return;
    try {
      await sendCode(email, code, purpose);
    } catch {
      await pool.query(`DELETE FROM ${table} WHERE email = $1 AND token_hash = $2`, [
        email,
        digest,
      ]);
      console.error('Account email could not be sent.');
    }
  }

  return {
    async rateLimit(namespace: string, value: string, limit: number): Promise<void> {
      const now = Date.now();
      if (now >= nextCleanup) {
        nextCleanup = now + 60_000;
        await pool.query('DELETE FROM account_attempt_limits WHERE expires_at <= now()');
      }
      const result = await pool.query(
        `INSERT INTO account_attempt_limits (bucket, attempts, expires_at) VALUES ($1, 1, now() + interval '1 minute')
         ON CONFLICT (bucket) DO UPDATE SET
           attempts = CASE WHEN account_attempt_limits.expires_at <= now() THEN 1 ELSE account_attempt_limits.attempts + 1 END,
           expires_at = CASE WHEN account_attempt_limits.expires_at <= now() THEN excluded.expires_at ELSE account_attempt_limits.expires_at END
         WHERE account_attempt_limits.expires_at <= now() OR account_attempt_limits.attempts < $2
         RETURNING bucket`,
        [`${namespace}:${hashToken(value)}`, limit],
      );
      if (!result.rowCount) throw new AccountFailure('rate-limited');
    },

    register: (email: string) => issueEmailCode(email, 'verify'),
    recover: (email: string) => issueEmailCode(email, 'reset'),

    async verify(
      email: string,
      code: string,
      password: string,
      device: DeviceInput,
    ): Promise<string> {
      const digest = hashToken(code);
      const pending = await pool.query(
        'SELECT 1 FROM account_verifications WHERE email = $1 AND token_hash = $2 AND expires_at > now()',
        [email, digest],
      );
      if (!pending.rowCount) throw new AccountFailure('invalid-code');
      const hash = await createPasswordHash(password);
      return transaction(pool, async (client) => {
        const consumed = await client.query(
          'DELETE FROM account_verifications WHERE email = $1 AND token_hash = $2 AND expires_at > now()',
          [email, digest],
        );
        if (!consumed.rowCount) throw new AccountFailure('invalid-code');
        const accountId = randomUUID();
        const created = await client.query(
          'INSERT INTO accounts (id, email, password_hash) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING',
          [accountId, email, hash],
        );
        if (!created.rowCount) throw new AccountFailure('invalid-code');
        return startSession(client, accountId, device);
      });
    },

    async signIn(
      email: string,
      password: string,
      device: DeviceInput,
      factor?: string,
    ): Promise<string> {
      const result = await pool.query<{ id: string; password_hash: string }>(
        'SELECT id, password_hash FROM accounts WHERE email = $1',
        [email],
      );
      const account = result.rows[0];
      if (!(await passwordMatches(password, account?.password_hash ?? dummyHash)) || !account)
        throw new AccountFailure('invalid-login');
      return transaction(pool, async (client) => {
        const current = await lockAccount(client, account.id);
        if (current.password_hash !== account.password_hash)
          throw new AccountFailure('invalid-login');
        await consumeFactor(client, current, factor);
        return startSession(client, account.id, device);
      });
    },

    async resetPassword(
      email: string,
      code: string,
      password: string,
      factor?: string,
    ): Promise<void> {
      const digest = hashToken(code);
      const pending = await pool.query<{ id: string }>(
        `SELECT a.id FROM account_password_resets r JOIN accounts a ON a.email = r.email
         WHERE r.email = $1 AND r.token_hash = $2 AND r.expires_at > now()`,
        [email, digest],
      );
      const accountId = pending.rows[0]?.id;
      if (!accountId) throw new AccountFailure('invalid-code');
      const hash = await createPasswordHash(password);
      await transaction(pool, async (client) => {
        const account = await lockAccount(client, accountId);
        const consumed = await client.query(
          'DELETE FROM account_password_resets WHERE email = $1 AND token_hash = $2 AND expires_at > now()',
          [email, digest],
        );
        if (!consumed.rowCount) throw new AccountFailure('invalid-code');
        await consumeFactor(client, account, factor);
        await client.query(
          `UPDATE accounts SET password_hash = $2, mfa_pending_secret = NULL,
             mfa_pending_session_id = NULL, mfa_pending_until = NULL WHERE id = $1`,
          [accountId, hash],
        );
        await client.query('DELETE FROM account_sessions WHERE account_id = $1', [accountId]);
      });
    },

    async protect(
      token: string,
      action: ProtectionAction,
    ): Promise<{ key?: string; recoveryCodes?: string[] }> {
      return transaction(pool, async (client) => {
        const { account, sessionId } = await accountForSession(client, token);
        const id = account.id;
        if (action.kind === 'revoke-session') {
          const revoked = await client.query(
            'DELETE FROM account_sessions WHERE account_id = $1 AND id = $2 AND id <> $3 AND expires_at > now()',
            [id, action.sessionId, sessionId],
          );
          if (!revoked.rowCount) throw new AccountFailure('session-missing');
          return {};
        }
        if (
          'password' in action &&
          !(await passwordMatches(action.password, account.password_hash))
        )
          throw new AccountFailure('invalid-login');
        if (action.kind === 'start-mfa') {
          if (account.mfa_secret) throw new AccountFailure('mfa-state');
          const key = newAuthenticatorKey();
          await client.query(
            `UPDATE accounts SET mfa_pending_secret = $2, mfa_pending_session_id = $3,
               mfa_pending_until = now() + interval '10 minutes' WHERE id = $1`,
            [id, sealAuthenticator(mfaKey, id, key), sessionId],
          );
          return { key };
        }
        if (action.kind === 'enable-mfa') {
          if (
            account.mfa_secret ||
            !account.mfa_pending_secret ||
            !account.mfa_pending_valid ||
            account.mfa_pending_session_id !== sessionId
          )
            throw new AccountFailure('mfa-state');
          const step = authenticatorStep(
            openAuthenticator(mfaKey, id, account.mfa_pending_secret),
            action.factor,
          );
          if (step === undefined) throw new AccountFailure('invalid-factor');
          const recoveryCodes = Array.from({ length: 8 }, () => randomBytes(16).toString('hex'));
          await client.query(
            `UPDATE accounts SET mfa_secret = mfa_pending_secret, mfa_last_step = $2,
               mfa_recovery_hashes = $3, mfa_pending_secret = NULL,
               mfa_pending_session_id = NULL, mfa_pending_until = NULL WHERE id = $1`,
            [id, step, recoveryCodes.map(hashToken)],
          );
          await client.query('DELETE FROM account_sessions WHERE account_id = $1 AND id <> $2', [
            id,
            sessionId,
          ]);
          return { recoveryCodes };
        }
        if (!account.mfa_secret) throw new AccountFailure('mfa-state');
        await consumeFactor(client, account, action.factor);
        await client.query(
          `UPDATE accounts SET mfa_secret = NULL, mfa_last_step = NULL, mfa_recovery_hashes = '{}' WHERE id = $1`,
          [id],
        );
        await client.query('DELETE FROM account_sessions WHERE account_id = $1 AND id <> $2', [
          id,
          sessionId,
        ]);
        return {};
      });
    },

    async session(token: string): Promise<AccountSummary> {
      const result = await pool.query<AccountSummary>(
        `SELECT a.id AS "accountId", a.email, a.mfa_secret IS NOT NULL AS "mfaEnabled", s.id AS "currentSessionId", s.device_id AS "currentDeviceId",
           (SELECT jsonb_agg(d) FROM (
             SELECT id, name, last_signed_in_at AS "lastSignedInAt", retired_at AS "retiredAt" FROM account_devices
             WHERE account_id = a.id ORDER BY (id = s.device_id) DESC, last_signed_in_at DESC LIMIT 50
           ) d) AS devices,
           (SELECT jsonb_agg(active) FROM (
             SELECT id, device_id AS "deviceId", created_at AS "createdAt", expires_at AS "expiresAt"
             FROM account_sessions WHERE account_id = a.id AND expires_at > now()
             ORDER BY (id = s.id) DESC, created_at DESC LIMIT 50
           ) active) AS sessions
         FROM account_sessions s JOIN accounts a ON a.id = s.account_id
         WHERE s.token_hash = $1 AND s.expires_at > now()`,
        [hashToken(token)],
      );
      const session = result.rows[0];
      if (!session) throw new AccountFailure('sign-in-required');
      return session;
    },

    async deviceDirectory(token: string, action?: Record<string, unknown>) {
      return transaction(pool, async (client) => {
        const { account, deviceId } = await accountForSession(client, token);
        if (action) await changeDeviceDirectory(client, account.id, deviceId, action);
        const result = await client.query<DeviceDirectoryKey>(
          `SELECT d.id AS "deviceId", d.name AS "deviceName", k.identity_id AS "identityId",
                  k.name, k.public_key AS "publicKey", k.fingerprint
           FROM account_device_keys k JOIN account_devices d ON (k.account_id, k.device_id) = (d.account_id, d.id)
           WHERE k.account_id = $1 ORDER BY d.name, k.name, k.device_id, k.identity_id`,
          [account.id],
        );
        return { keys: result.rows };
      });
    },

    async organizations(token: string, action: OrganizationAction) {
      return transaction(pool, async (client) => {
        const { account } = await accountForSession(client, token);
        return organizationView(client, account, action);
      });
    },

    async organizationEvents(token: string, query: AdministrativeQuery) {
      return transaction(pool, async (client) => {
        const { account } = await accountForSession(client, token);
        if ((await lockOrganization(client, query.organizationId)) !== account.id)
          throw new AccountFailure('organization-denied');
        return readAdministrativeEvents(client, query);
      });
    },

    async organizationVault(
      token: string,
      organizationId: string,
      vaultId: string,
      write?: OrganizationVaultWrite,
    ) {
      return transaction(pool, async (client) => {
        const { account } = await accountForSession(client, token);
        return vaultSnapshot(client, account, organizationId, vaultId, write);
      });
    },

    async organizationVaultAccess(token: string, action: VaultAccessAction) {
      return transaction(pool, async (client) => {
        const { account } = await accountForSession(client, token);
        return vaultAccessView(client, account, action);
      });
    },

    async sharedLogs(token: string, action: SharedLogRequest) {
      return transaction(pool, async (client) => {
        const { account } = await accountForSession(client, token);
        return sharedLogs(client, account, action);
      });
    },

    async liveTerminal(token: string, action: LiveRelayAction) {
      return transaction(pool, async (client) => {
        const { account, sessionId } = await accountForSession(client, token);
        return live.handle(client, account.id, sessionId, action);
      });
    },

    async signOut(token: string): Promise<void> {
      await pool.query('DELETE FROM account_sessions WHERE token_hash = $1', [hashToken(token)]);
    },

    async workspaceSnapshot(token: string, credentials = false): Promise<SyncSnapshot> {
      const table = credentials ? 'account_credential_sync' : 'account_workspace_sync';
      const result = await pool.query<SyncSnapshot>(
        `SELECT s.account_id AS "accountId", COALESCE(w.revision, 0) AS revision, w.envelope
         FROM account_sessions s LEFT JOIN ${table} w ON w.account_id = s.account_id
         WHERE s.token_hash = $1 AND s.expires_at > now()`,
        [hashToken(token)],
      );
      const snapshot = result.rows[0];
      if (!snapshot) throw new AccountFailure('sign-in-required');
      return snapshot;
    },

    async saveWorkspaceSnapshot(
      token: string,
      expectedRevision: number,
      envelope: SyncEnvelope,
      writeProof: string,
      credentials = false,
    ): Promise<number> {
      const table = credentials ? 'account_credential_sync' : 'account_workspace_sync';
      return transaction(pool, async (client) => {
        const { account } = await accountForSession(client, token);
        const revision = expectedRevision + 1;
        const proofHash = hashToken(writeProof);
        const result =
          expectedRevision === 0
            ? await client.query(
                `INSERT INTO ${table} (account_id, revision, envelope, write_hash) VALUES ($1, 1, $2, $3)
             ON CONFLICT (account_id) DO NOTHING`,
                [account.id, JSON.stringify(envelope), proofHash],
              )
            : await client.query(
                `UPDATE ${table} SET revision = $2, envelope = $3
             WHERE account_id = $1 AND revision = $4 AND write_hash = $5
               AND (envelope->>'version')::integer <= $6`,
                [
                  account.id,
                  revision,
                  JSON.stringify(envelope),
                  expectedRevision,
                  proofHash,
                  envelope.version,
                ],
              );
        if (!result.rowCount) throw new AccountFailure('sync-conflict');
        return revision;
      });
    },
  };
}
