import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { AccountErrorCode, AccountSummary } from '../../../packages/shared/accounts.ts';
import { transaction } from './database.ts';

const scryptOptions = { N: 32_768, r: 8, p: 3, maxmem: 48 * 1024 * 1024 };
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const makeToken = () => randomBytes(32).toString('base64url');
const dummyHash = `${randomBytes(16).toString('hex')}:${randomBytes(64).toString('hex')}`;

export interface DeviceInput {
  id: string;
  name: string;
}

export class AccountFailure extends Error {
  readonly code: AccountErrorCode;

  constructor(code: AccountErrorCode) {
    super(code);
    this.code = code;
  }
}

function passwordHash(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, scryptOptions, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

async function startSession(
  client: PoolClient,
  accountId: string,
  device: DeviceInput,
): Promise<string> {
  const token = makeToken();
  await client.query(
    `INSERT INTO account_devices (account_id, id, name) VALUES ($1, $2, $3)
     ON CONFLICT (account_id, id) DO UPDATE SET name = excluded.name, last_signed_in_at = now()`,
    [accountId, device.id, device.name],
  );
  await client.query(
    `INSERT INTO account_sessions (id, account_id, device_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, now() + interval '30 days')
     ON CONFLICT (account_id, device_id) DO UPDATE SET
       id = excluded.id, token_hash = excluded.token_hash, created_at = now(), expires_at = excluded.expires_at`,
    [randomUUID(), accountId, device.id, hashToken(token)],
  );
  return token;
}

export function createAccounts(
  pool: Pool,
  sendVerification: (email: string, code: string) => Promise<void>,
) {
  return {
    async register(email: string): Promise<void> {
      const code = makeToken();
      const digest = hashToken(code);
      const issued = await pool.query(
        `INSERT INTO account_verifications (email, token_hash, expires_at)
         SELECT $1, $2, now() + interval '20 minutes' WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE email = $1)
         ON CONFLICT (email) DO UPDATE SET token_hash = excluded.token_hash, created_at = now(), expires_at = excluded.expires_at
         WHERE account_verifications.created_at <= now() - interval '1 minute'
         RETURNING email`,
        [email, digest],
      );
      if (!issued.rowCount) return;
      try {
        await sendVerification(email, code);
      } catch {
        await pool.query('DELETE FROM account_verifications WHERE email = $1 AND token_hash = $2', [
          email,
          digest,
        ]);
        // Keep the response identical to the response for a previously registered address.
        console.error('Account verification email could not be sent.');
      }
    },

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
      const salt = randomBytes(16).toString('hex');
      const hash = `${salt}:${(await passwordHash(password, salt)).toString('hex')}`;
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

    async signIn(email: string, password: string, device: DeviceInput): Promise<string> {
      const result = await pool.query<{ id: string; password_hash: string }>(
        'SELECT id, password_hash FROM accounts WHERE email = $1',
        [email],
      );
      const account = result.rows[0];
      const [salt, hash] = (account?.password_hash ?? dummyHash).split(':');
      const derived = await passwordHash(password, salt!);
      if (!timingSafeEqual(derived, Buffer.from(hash!, 'hex')) || !account)
        throw new AccountFailure('invalid-login');
      return transaction(pool, (client) => startSession(client, account.id, device));
    },

    async session(token: string): Promise<AccountSummary> {
      const result = await pool.query<AccountSummary>(
        `SELECT a.email, s.id AS "currentSessionId", s.device_id AS "currentDeviceId",
           (SELECT jsonb_agg(d) FROM (
             SELECT id, name, last_signed_in_at AS "lastSignedInAt" FROM account_devices
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

    async signOut(token: string): Promise<void> {
      await pool.query('DELETE FROM account_sessions WHERE token_hash = $1', [hashToken(token)]);
    },
  };
}
