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
  const sql = await readFile(new URL('../migrations/001_accounts.sql', import.meta.url), 'utf8');
  await transaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(714059)');
    await client.query(
      'CREATE TABLE IF NOT EXISTS mterminal_migrations (version integer PRIMARY KEY)',
    );
    const applied = await client.query('SELECT 1 FROM mterminal_migrations WHERE version = 1');
    if (applied.rowCount) return;
    await client.query(sql);
    await client.query('INSERT INTO mterminal_migrations (version) VALUES (1)');
  });
}
