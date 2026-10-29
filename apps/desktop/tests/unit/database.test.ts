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
  it('exports versioned metadata without secrets and atomically merges it', async () => {
    await fixture(async (directory) => {
      let source: LocalDatabase | undefined;
      let target: LocalDatabase | undefined;
      try {
        source = await LocalDatabase.open(join(directory, 'source.sqlite'));
        const identity = source.saveSshIdentity({
          name: 'Production',
          username: 'ops',
          method: 'password',
        });
        source.saveHostGroup({
          path: 'Production',
          port: 2222,
          username: 'ops',
          identityId: identity.id,
        });
        source.saveHost({
          name: 'API',
          address: 'api.example.com',
          port: 2222,
          username: 'ops',
          protocol: 'ssh',
          groupPath: 'Production',
          identityId: identity.id,
        });
        source.trustKnownHost('api.example.com', 2222, `SHA256:${'a'.repeat(43)}`);
        const archive = source.exportWorkspace();
        expect(Object.keys(archive)).not.toContain('secrets');
        target = await LocalDatabase.open(join(directory, 'target.sqlite'));
        expect(target.importWorkspace(archive)).toBe(4);
        expect(target.listHosts()).toHaveLength(1);
        expect(target.listSshIdentities()).toEqual([identity]);
        expect(target.getKnownHost('api.example.com', 2222)).toBe(`SHA256:${'a'.repeat(43)}`);
        expect(() => target!.importWorkspace(archive)).toThrow('No records were imported');
        expect(target.listHosts()).toHaveLength(1);
      } finally {
        source?.close();
        target?.close();
      }
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
