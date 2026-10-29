import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateIdentity, validateHost, resolveHost } from '../../src/shared/hosts.js';
import { LocalDatabase } from '../../src/main/storage/database.js';

describe('reusable SSH identities', () => {
  it('validates metadata without accepting or returning secret fields', () => {
    const identity = validateIdentity({
      name: 'Ops',
      username: 'deploy',
      method: 'privateKey',
      password: 'must be ignored',
    });
    expect(identity).toEqual({ name: 'Ops', username: 'deploy', method: 'privateKey' });
    expect(() =>
      validateIdentity({ name: 'Bad', username: 'two words', method: 'password' }),
    ).toThrow();
    expect(() => validateIdentity({ name: 'Bad', username: 'ops', method: 'unknown' })).toThrow();
    expect(() =>
      validateHost({
        name: 'target',
        address: 'example.test',
        port: 22,
        username: '',
        protocol: 'ssh',
        identityId: 'not-an-id',
      }),
    ).toThrow();
  });

  it('shares identity references through groups, persists them and clears deleted references safely', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mterminal-identities-'));
    let db: LocalDatabase | undefined;
    try {
      const path = join(directory, 'data.sqlite');
      db = await LocalDatabase.open(path);
      const parent = db.saveSshIdentity({
        name: 'Operations',
        username: 'ops',
        method: 'password',
      });
      const child = db.saveSshIdentity({
        name: 'Production',
        username: 'deploy',
        method: 'privateKey',
      });
      db.saveHostGroup({ path: 'Work', port: null, username: null, identityId: parent.id });
      db.saveHostGroup({ path: 'Work/Prod', port: null, username: null, identityId: child.id });
      const inherited = db.saveHost({
        name: 'Inherited',
        address: 'prod.example.test',
        port: 22,
        username: '',
        protocol: 'ssh',
        groupPath: 'Work/Prod',
      });
      const overridden = db.saveHost({
        name: 'Override',
        address: 'override.example.test',
        port: 22,
        username: '',
        protocol: 'ssh',
        groupPath: 'Work/Prod',
        identityId: parent.id,
      });
      expect(resolveHost(inherited, db.listHostGroups()).identityId).toBe(child.id);
      expect(resolveHost(overridden, db.listHostGroups()).identityId).toBe(parent.id);
      expect(db.listSshIdentities()).toHaveLength(2);

      db.close();
      db = undefined;
      db = await LocalDatabase.open(path);
      expect(resolveHost(db.listHosts()[0]!, db.listHostGroups()).identityId).toBe(child.id);
      expect(db.listSshIdentities().map(({ name }) => name)).toEqual(['Operations', 'Production']);
      expect(db.listHosts()[0]).not.toHaveProperty('password');
      expect(db.listSshIdentities()[0]).not.toHaveProperty('password');
      const storedColumns = db.transaction((connection) =>
        connection
          .prepare('PRAGMA table_info(ssh_identities)')
          .all()
          .map((column) => column.name),
      );
      expect(storedColumns).not.toEqual(
        expect.arrayContaining(['password', 'privateKey', 'passphrase']),
      );

      db.deleteSshIdentity(child.id);
      expect(
        resolveHost(
          db.listHosts().find((host) => host.id === inherited.id)!,
          db.listHostGroups(),
        ).identityId,
      ).toBe(parent.id);
      db.deleteSshIdentity(parent.id);
      expect(db.listHosts().every((host) => host.identityId === null)).toBe(true);
      expect(db.listHostGroups().every((group) => group.identityId === null)).toBe(true);
    } finally {
      db?.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
