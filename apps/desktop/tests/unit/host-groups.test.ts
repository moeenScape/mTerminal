import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateHost, validateGroupPath, resolveHost } from '../../src/shared/hosts.js';
import { LocalDatabase } from '../../src/main/storage/database.js';
const draft = {
  name: 'Host',
  address: 'example.com',
  port: 22,
  username: 'local',
  protocol: 'ssh',
};

describe('host organization', () => {
  it('bounds and normalizes tags and rejects invalid paths and flags', () => {
    expect(validateHost({ ...draft, tags: [' PROD ', 'prod', 'dev'] }).tags).toEqual([
      'dev',
      'prod',
    ]);
    for (const path of ['a//b', '/a', 'a/', 'a/..', 'a/ b', 'a/'.repeat(9) + 'z'])
      expect(() => validateGroupPath(path)).toThrow();
    for (const extra of [{ tags: [''] }, { tags: Array(21).fill('tag') }, { inheritPort: 'yes' }])
      expect(() => validateHost({ ...draft, ...extra })).toThrow();
  });
  it('inherits nearest defaults, honors host overrides, and preserves values on deletion', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mterminal-groups-'));
    let db: LocalDatabase | undefined;
    try {
      const path = join(directory, 'data.sqlite');
      db = await LocalDatabase.open(path);
      expect(() =>
        db!.saveHostGroup({ path: 'Missing/Child', port: null, username: null }),
      ).toThrow();
      db.saveHostGroup({ path: 'Work', port: 2222, username: 'ops' });
      db.saveHostGroup({ path: 'Work/Prod', port: null, username: 'deploy' });
      db.saveHostGroup({ path: 'Workshop', port: null, username: null });
      const host = db.saveHost({
        ...draft,
        groupPath: 'Work/Prod',
        tags: ['prod'],
        inheritPort: true,
        inheritUsername: true,
      });
      expect(resolveHost(host, db.listHostGroups())).toMatchObject({
        port: 2222,
        username: 'deploy',
      });
      expect(
        resolveHost({ ...host, inheritPort: false, inheritUsername: false }, db.listHostGroups()),
      ).toMatchObject({ port: 22, username: 'local' });
      db.saveHostGroup({ path: 'Work', port: 2200, username: 'ops' });
      expect(resolveHost(host, db.listHostGroups()).port).toBe(2200);
      db.close();
      db = undefined;
      db = await LocalDatabase.open(path);
      expect(db.listHosts()[0]?.tags).toEqual(['prod']);
      db.deleteHostGroup('Work');
      expect(db.listHostGroups().map((g) => g.path)).toEqual(['Workshop']);
      expect(db.listHosts()[0]).toMatchObject({
        id: host.id,
        groupPath: '',
        tags: ['prod'],
        port: 2200,
        username: 'deploy',
        inheritPort: false,
        inheritUsername: false,
      });
      expect(() => db!.saveHost({ ...draft, groupPath: 'Work' })).toThrow();
    } finally {
      db?.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('upgrades v2 profiles with no changes to connection values', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mterminal-v2-'));
    let db: LocalDatabase | undefined;
    try {
      const path = join(directory, 'data.sqlite');
      db = await LocalDatabase.open(path);
      const host = db.saveHost(draft);
      db.transaction((connection) =>
        connection.exec(`
        CREATE TABLE hosts_v2 (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, address TEXT NOT NULL,
          port INTEGER NOT NULL CHECK(port BETWEEN 1 AND 65535), username TEXT NOT NULL,
          protocol TEXT NOT NULL CHECK(protocol = 'ssh')
        ) STRICT;
        INSERT INTO hosts_v2 SELECT id,name,address,port,username,protocol FROM hosts;
        DROP TABLE hosts; ALTER TABLE hosts_v2 RENAME TO hosts;
        DROP TABLE host_groups; DROP TABLE known_hosts; DROP TABLE transfer_recovery; DROP TABLE workspace_templates; DROP TABLE ssh_identities;
        DELETE FROM schema_migrations WHERE version>=3;
        PRAGMA user_version=2;
      `),
      );
      db.close();
      db = undefined;
      db = await LocalDatabase.open(path);
      expect(db.listHosts()).toEqual([host]);
      expect(db.listHostGroups()).toEqual([]);
    } finally {
      db?.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
