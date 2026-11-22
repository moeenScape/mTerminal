import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalDatabase } from '../../src/main/storage/database.js';
import { resolveHost } from '../../src/shared/hosts.js';
const draft = {
  name: 'Build',
  address: 'example.internal',
  username: 'deploy',
  port: 22,
  protocol: 'ssh',
};
async function fixture(operation: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'mterminal-environment-'));
  try {
    await operation(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
describe('environment persistence and migration', () => {
  it('persists overrides, round-trips backups and materializes inherited values when deleting groups', async () => {
    await fixture(async (directory) => {
      const path = join(directory, 'data.sqlite');
      let db = await LocalDatabase.open(path);
      let imported: LocalDatabase | undefined;
      try {
        db.saveHostGroup({
          path: 'Work',
          port: null,
          username: null,
          environment: [
            { name: 'BASE', value: 'parent' },
            { name: 'APP_ENV', value: 'base' },
          ],
        });
        db.saveHostGroup({
          path: 'Work/Prod',
          port: null,
          username: null,
          environment: [{ name: 'APP_ENV', value: 'production' }],
        });
        const host = db.saveHost({
          ...draft,
          groupPath: 'Work/Prod',
          environment: [{ name: 'BASE', value: '' }],
        });
        const expected = resolveHost(host, db.listHostGroups()).environment;
        db.close();
        db = await LocalDatabase.open(path);
        expect(db.listHosts()[0]?.environment).toEqual([{ name: 'BASE', value: '' }]);
        expect(resolveHost(db.listHosts()[0]!, db.listHostGroups()).environment).toEqual(expected);
        const backup = db.exportWorkspace();
        imported = await LocalDatabase.open(join(directory, 'imported.sqlite'));
        imported.importWorkspace(backup);
        expect(imported.listHosts()).toEqual(db.listHosts());
        expect(imported.listHostGroups()).toEqual(db.listHostGroups());
        expect(() => imported!.importWorkspace(backup)).toThrow();
        expect(imported.listHosts()).toEqual(db.listHosts());
        db.deleteHostGroup('Work');
        expect(db.listHostGroups()).toEqual([]);
        expect(db.listHosts()[0]).toMatchObject({
          id: host.id,
          groupPath: '',
          environment: expected,
        });
        const cleared = db.saveHost({ ...db.listHosts()[0]!, environment: [] }, host.id);
        expect(cleared.environment).toBeUndefined();
        expect(db.listHosts()[0]?.environment).toBeUndefined();
      } finally {
        db.close();
        imported?.close();
      }
    });
  });
  it('rolls back a parent edit that exceeds an existing host’s effective-variable limit', async () => {
    await fixture(async (directory) => {
      const db = await LocalDatabase.open(join(directory, 'data.sqlite'));
      try {
        db.saveHostGroup({ path: 'Work', port: null, username: null });
        const environment = Array.from({ length: 32 }, (_, n) => ({
          name: `LOCAL_${n}`,
          value: 'kept',
        }));
        const host = db.saveHost({ ...draft, groupPath: 'Work', environment });
        const groups = db.listHostGroups();
        expect(() =>
          db.saveHostGroup({ ...groups[0]!, environment: [{ name: 'EXTRA', value: 'overflow' }] }),
        ).toThrow('Environment');
        expect(db.listHostGroups()).toEqual(groups);
        expect(db.listHosts()).toEqual([host]);
        expect(() =>
          db.saveHost({ ...host, environment: [{ name: 'BAD-NAME', value: 'no' }] }, host.id),
        ).toThrow('Environment');
        expect(db.listHosts()).toEqual([host]);
      } finally {
        db.close();
      }
    });
  });
  it('upgrades v7 non-destructively, snapshots it and leaves old profiles without variables', async () => {
    await fixture(async (directory) => {
      const path = join(directory, 'data.sqlite');
      let db = await LocalDatabase.open(path);
      const workspace = db.workspaceId;
      const host = db.saveHost(draft);
      db.saveHostGroup({ path: 'Kept', port: 2222, username: 'ops' });
      const groups = db.listHostGroups();
      db.transaction((connection) =>
        connection.exec(
          'DROP TABLE serial_profiles; ALTER TABLE hosts DROP COLUMN useAgent; ALTER TABLE hosts DROP COLUMN agentForwarding; DROP TABLE proxies; ALTER TABLE hosts DROP COLUMN proxyId; DROP TABLE port_forwards; ALTER TABLE hosts DROP COLUMN jumpHostId; ALTER TABLE hosts DROP COLUMN environment; ALTER TABLE host_groups DROP COLUMN environment; DELETE FROM schema_migrations WHERE version>=8; PRAGMA user_version=7;',
        ),
      );
      db.close();
      db = await LocalDatabase.open(path);
      try {
        expect(db.workspaceId).toBe(workspace);
        expect(db.listHosts()).toEqual([host]);
        expect(db.listHostGroups()).toEqual(groups);
        expect((await readdir(join(directory, 'backups'))).length).toBeGreaterThan(1);
        db.transaction((connection) =>
          expect(connection.prepare('PRAGMA user_version').get()?.user_version).toBe(13),
        );
      } finally {
        db.close();
      }
    });
  });
});
