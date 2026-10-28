import { mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { LocalDatabase, recoverDatabase } from '../../src/main/storage/database.js';

async function fixture(operation: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'mterminal-database-'));
  try {
    await operation(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('local SQLite storage', () => {
  it('migrates once, persists UUIDs, and rolls back failed transactions', async () => {
    await fixture(async (directory) => {
      const path = join(directory, 'mterminal.sqlite');
      const database = await LocalDatabase.open(path);
      const id = database.workspaceId;
      await expect(LocalDatabase.open(path)).rejects.toThrow();
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      expect(() =>
        database.transaction((connection) => {
          connection.prepare('UPDATE workspaces SET name = ?').run('changed');
          throw new Error('abort');
        }),
      ).toThrow('abort');
      database.close();
      const reopened = await LocalDatabase.open(path);
      expect(reopened.workspaceId).toBe(id);
      reopened.close();
      expect(await readdir(join(directory, 'backups'))).toHaveLength(1);
    });
  });
  it('restores a validated snapshot and preserves the original file', async () => {
    await fixture(async (directory) => {
      const path = join(directory, 'mterminal.sqlite');
      const database = await LocalDatabase.open(path);
      const id = database.workspaceId;
      const snapshot = await database.createBackup(join(directory, 'backups'));
      database.close();
      await writeFile(path, 'damaged file');
      await recoverDatabase(snapshot, path);
      const reopened = await LocalDatabase.open(path);
      expect(reopened.workspaceId).toBe(id);
      reopened.close();
      const preserved = (await readdir(directory)).find((name) =>
        name.includes('.before-recovery-'),
      );
      expect(await readFile(join(directory, preserved!), 'utf8')).toBe('damaged file');
    });
  });
  it('refuses corrupt backups, unknown schemas, and recovery with live journals', async () => {
    await fixture(async (directory) => {
      const path = join(directory, 'mterminal.sqlite');
      const database = await LocalDatabase.open(path);
      database.close();
      const before = await readFile(path);
      const invalid = join(directory, 'invalid.sqlite');
      await writeFile(invalid, 'invalid');
      await expect(recoverDatabase(invalid, path)).rejects.toThrow();
      expect(await readFile(path)).toEqual(before);
      await writeFile(path + '-wal', 'uncheckpointed');
      await expect(
        recoverDatabase(
          join(directory, 'backups', (await readdir(join(directory, 'backups')))[0]!),
          path,
        ),
      ).rejects.toThrow('journal');
      await rm(path + '-wal');
      const connection = new DatabaseSync(path);
      connection.exec('PRAGMA user_version = 999');
      connection.close();
      const newer = await readFile(path);
      await expect(LocalDatabase.open(path)).rejects.toThrow('unsupported schema');
      expect(await readFile(path)).toEqual(newer);
    });
  });
});
