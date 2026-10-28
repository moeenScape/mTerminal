import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateHost } from '../../src/shared/hosts.js';
import { LocalDatabase } from '../../src/main/storage/database.js';

const draft = { name: 'Build', address: '::1', port: 22, username: 'deploy', protocol: 'ssh' };
describe('saved host profiles', () => {
  it('rejects malformed profiles and excludes unexpected fields', () => {
    expect(validateHost({ ...draft, password: 'never persist' })).toEqual(draft);
    for (const change of [
      { port: 0 },
      { port: 65536 },
      { port: 1.5 },
      { name: '' },
      { address: '-option' },
      { address: 'ssh://example.com' },
      { username: 'a\nb' },
      { protocol: 'telnet' },
    ])
      expect(() => validateHost({ ...draft, ...change })).toThrow();
  });
  it('persists profiles, updates only existing IDs and deletes without affecting peers', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mterminal-hosts-'));
    let db: LocalDatabase | undefined;
    try {
      const path = join(directory, 'data.sqlite');
      db = await LocalDatabase.open(path);
      const one = db.saveHost(draft);
      const two = db.saveHost({ ...draft, name: 'Peer' });
      db.close();
      db = undefined;
      db = await LocalDatabase.open(path);
      expect(db.listHosts()).toHaveLength(2);
      expect(db.saveHost({ ...draft, port: 2222 }, one.id).port).toBe(2222);
      db.deleteHost(one.id);
      expect(db.listHosts()).toEqual([two]);
      expect(() => db!.saveHost(draft, one.id)).toThrow();
      expect(() => db!.deleteHost('../invalid')).toThrow();
    } finally {
      db?.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('upgrades schema v1 without changing the workspace', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mterminal-upgrade-'));
    let db: LocalDatabase | undefined;
    try {
      const path = join(directory, 'data.sqlite');
      db = await LocalDatabase.open(path);
      const id = db.workspaceId;
      db.transaction((connection) =>
        connection.exec(
          'DROP TABLE hosts; DELETE FROM schema_migrations WHERE version=2; PRAGMA user_version=1;',
        ),
      );
      db.close();
      db = undefined;
      db = await LocalDatabase.open(path);
      expect(db.workspaceId).toBe(id);
      expect(db.listHosts()).toEqual([]);
      expect(db.saveHost(draft).address).toBe('::1');
    } finally {
      db?.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
