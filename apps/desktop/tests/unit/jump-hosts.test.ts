import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { jumpChain, validateHost, MAX_JUMP_HOPS, type SavedHost } from '../../src/shared/hosts.js';
import { validateWorkspaceBackup } from '../../src/shared/backup.js';
import { LocalDatabase } from '../../src/main/storage/database.js';
import { savedJumpCredentials } from '../../src/main/terminal/jump.js';
import { sshAuthConfig } from '../../src/main/terminal/ssh.js';
import type { SshSecretStore } from '../../src/main/storage/secret-store.js';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function host(name: string, jumpHostId?: string): SavedHost {
  return {
    id: randomUUID(),
    name,
    address: `${name}.internal`,
    port: 22,
    username: 'ops',
    protocol: 'ssh',
    ...(jumpHostId ? { jumpHostId } : {}),
  };
}
async function openDatabase() {
  const directory = await mkdtemp(join(tmpdir(), 'mterminal-jump-'));
  const database = await LocalDatabase.open(join(directory, 'data.sqlite'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  cleanups.push(() => database.close());
  return database;
}
const draft = (name: string, jumpHostId?: string) => ({
  name,
  address: `${name}.internal`,
  port: 22,
  username: 'ops',
  protocol: 'ssh' as const,
  ...(jumpHostId ? { jumpHostId } : {}),
});

describe('jump host chains', () => {
  it('orders hops from the first jump host to the last', () => {
    const outer = host('outer');
    const inner = host('inner', outer.id);
    const target = host('target', inner.id);
    expect(jumpChain(target, [outer, inner, target]).map((item) => item.name)).toEqual([
      'outer',
      'inner',
    ]);
    expect(jumpChain(outer, [outer])).toEqual([]);
  });
  it('rejects missing hosts, loops and chains longer than the limit', () => {
    const missing = host('missing', randomUUID());
    expect(() => jumpChain(missing, [missing])).toThrow();
    const a = host('a');
    const b = host('b', a.id);
    a.jumpHostId = b.id;
    expect(() => jumpChain(a, [a, b])).toThrow();
    const hops: SavedHost[] = [host('h0')];
    for (let index = 1; index <= MAX_JUMP_HOPS + 1; index++)
      hops.push(host(`h${index}`, hops[index - 1]!.id));
    expect(() => jumpChain(hops.at(-1)!, hops)).toThrow();
    expect(jumpChain(hops.at(-2)!, hops)).toHaveLength(MAX_JUMP_HOPS);
  });
  it('validates jump host IDs on host records', () => {
    const id = randomUUID();
    expect(validateHost(draft('x', id)).jumpHostId).toBe(id);
    expect(validateHost({ ...draft('x'), jumpHostId: '' }).jumpHostId).toBeUndefined();
    expect(() => validateHost({ ...draft('x'), jumpHostId: 'not-a-uuid' })).toThrow();
  });
});

describe('jump host storage', () => {
  it('persists jump hosts, refuses loops and clears references when a jump host is deleted', async () => {
    const database = await openDatabase();
    const bastion = database.saveHost(draft('bastion'));
    const target = database.saveHost(draft('target', bastion.id));
    expect(database.listHosts().find((item) => item.id === target.id)?.jumpHostId).toBe(bastion.id);
    expect(() => database.saveHost(draft('bastion', target.id), bastion.id)).toThrow();
    expect(() => database.saveHost(draft('target', target.id), target.id)).toThrow();
    expect(() => database.saveHost(draft('orphan', randomUUID()))).toThrow();
    database.deleteHost(bastion.id);
    const remaining = database.listHosts();
    expect(remaining.map((item) => item.id)).toEqual([target.id]);
    expect(remaining[0]?.jumpHostId).toBeUndefined();
  });
  it('round-trips jump hosts through workspace backups and rejects unresolved references', async () => {
    const source = await openDatabase();
    const bastion = source.saveHost(draft('bastion'));
    const target = source.saveHost(draft('target', bastion.id));
    const backup = source.exportWorkspace();
    const destination = await openDatabase();
    destination.importWorkspace({
      ...backup,
      // Order must not matter: the target is imported before its jump host.
      hosts: [...backup.hosts].reverse(),
    });
    expect(destination.listHosts().find((item) => item.id === target.id)?.jumpHostId).toBe(
      bastion.id,
    );
    expect(() =>
      validateWorkspaceBackup({
        ...backup,
        hosts: backup.hosts.filter((item) => item.id !== bastion.id),
      }),
    ).toThrow(/jump host/);
  });
});

describe('jump host logins', () => {
  function secrets(logins: Record<string, { username?: string; password: string }>, keys = {}) {
    return {
      getLogin: (id: string) => Promise.resolve(logins[id]),
      getPrivateKey: (id: string) => Promise.resolve((keys as Record<string, unknown>)[id]),
    } as unknown as SshSecretStore;
  }
  it('uses the host’s saved login, then the identity key, and never prompts', async () => {
    const database = await openDatabase();
    const bastion = database.saveHost(draft('bastion'));
    await expect(
      savedJumpCredentials(
        bastion,
        database,
        secrets({ [bastion.id]: { username: 'jump', password: 'pw' } }),
      ),
    ).resolves.toMatchObject({ username: 'jump', method: 'password', password: 'pw' });
    const identity = database.saveSshIdentity({
      name: 'Key',
      username: 'keyuser',
      method: 'privateKey',
    });
    const keyed = database.saveHost({ ...draft('keyed'), identityId: identity.id });
    await expect(
      savedJumpCredentials(
        keyed,
        database,
        secrets({}, { [identity.id]: { privateKey: 'KEY', passphrase: '' } }),
      ),
    ).resolves.toMatchObject({ username: 'keyuser', method: 'privateKey', privateKey: 'KEY' });
    await expect(savedJumpCredentials(bastion, database, secrets({}))).rejects.toMatchObject({
      code: 'ssh-jump-login-missing',
    });
    const locked = {
      getLogin: () => Promise.reject(new Error('locked')),
      getPrivateKey: () => Promise.reject(new Error('locked')),
    } as unknown as SshSecretStore;
    await expect(savedJumpCredentials(bastion, database, locked)).rejects.toMatchObject({
      code: 'ssh-jump-login-missing',
    });
  });
  it('builds the same authentication options for hops and targets', () => {
    expect(
      sshAuthConfig({ username: 'u', method: 'password', password: 'p', fingerprint: '' }),
    ).toEqual({ username: 'u', password: 'p', tryKeyboard: false, authHandler: ['password'] });
    expect(
      sshAuthConfig({
        username: 'u',
        method: 'privateKey',
        privateKey: 'k',
        passphrase: '',
        keyboardInteractive: true,
        fingerprint: '',
      }).authHandler,
    ).toEqual(['publickey', 'keyboard-interactive']);
  });
});
