import { readFile } from 'node:fs/promises';
import type { Pool, PoolClient } from 'pg';

export async function transaction<T>(
  pool: Pool,
  run: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      broken = true;
    }
    throw error;
  } finally {
    client.release(broken);
  }
}

export async function migrateAccounts(pool: Pool): Promise<void> {
  const migrations = [
    '001_accounts.sql',
    '002_account_protection.sql',
    '003_workspace_sync.sql',
    '004_credential_sync.sql',
    '005_device_directory.sql',
    '006_organizations.sql',
    '007_organization_vault.sql',
    '008_vault_permissions.sql',
    '009_shared_logs.sql',
    '010_administrative_events.sql',
  ];
  await transaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(714059)');
    await client.query(
      'CREATE TABLE IF NOT EXISTS mterminal_migrations (version integer PRIMARY KEY)',
    );
    const applied = await client.query<{ version: number }>(
      'SELECT version FROM mterminal_migrations',
    );
    const versions = new Set(applied.rows.map(({ version }) => version));
    if ([...versions].some((version) => version < 1 || version > migrations.length))
      throw new Error('Account schema is newer than this server.');
    for (const [index, name] of migrations.entries()) {
      const version = index + 1;
      if (!versions.has(version)) {
        await client.query(
          await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'),
        );
        await client.query('INSERT INTO mterminal_migrations (version) VALUES ($1)', [version]);
      }
    }
  });
}
