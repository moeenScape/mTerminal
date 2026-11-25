import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  CREDENTIAL_SYNC_ROUTE,
  type SyncSnapshot,
} from '../../../../packages/shared/workspace-sync.ts';
import { syncCredential } from '../../src/main/storage/credential-sync.js';
import { generateSyncKey } from '../../src/main/storage/workspace-sync.js';
import { SyncPreferenceStore } from '../../src/main/storage/sync-preferences.js';
import type { SavedHost } from '../../src/shared/hosts.js';

describe('independent credential sync', () => {
  it('keeps metadata and credentials independent across restarts, accounts and service origins', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mterminal-sync-prefs-'));
    const first = randomUUID();
    try {
      const store = new SyncPreferenceStore(directory, 'https://one.example', first);
      const defaults = { metadata: true, credentials: false };
      expect(await store.read()).toEqual(defaults);
      await store.write({ metadata: false, credentials: true });
      expect(await new SyncPreferenceStore(directory, 'https://one.example', first).read()).toEqual(
        { metadata: false, credentials: true },
      );
      expect(await new SyncPreferenceStore(directory, 'https://two.example', first).read()).toEqual(
        defaults,
      );
      expect(
        await new SyncPreferenceStore(directory, 'https://one.example', randomUUID()).read(),
      ).toEqual(defaults);
      await writeFile(store.path, '{"credentials":true}');
      await expect(store.read()).rejects.toThrow('sync-preferences-storage');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('publishes an opaque credential, restores it to a matching profile and refuses a redirected host', async () => {
    const account = randomUUID();
    const local: SavedHost = {
      id: randomUUID(),
      name: 'Production',
      address: 'production.example',
      port: 22,
      protocol: 'ssh',
      username: 'deploy',
    };
    const database = {
      listHosts: () => [local],
      listHostGroups: () => [],
      listSshIdentities: () => [],
    };
    const cloud: SyncSnapshot = { accountId: account, revision: 0, envelope: null };
    const writes: object[] = [];
    const request = vi.fn(async (route: string, method: 'GET' | 'PUT', body?: object) => {
      expect(route).toBe(CREDENTIAL_SYNC_ROUTE);
      if (method === 'GET') return { ...cloud };
      const update = body as {
        envelope: NonNullable<SyncSnapshot['envelope']>;
        expectedRevision: number;
      };
      expect(update.expectedRevision).toBe(cloud.revision);
      writes.push(update);
      cloud.envelope = update.envelope;
      cloud.revision++;
      return { revision: cloud.revision };
    });
    const vault = {
      vaultStatus: vi.fn(async () => ({ configured: true, locked: false, available: true })),
      getLogin: vi.fn(async () => ({ username: 'operator', password: 'server-secret' })),
      getPrivateKey: vi.fn(async () => undefined),
      restoreSyncedCredential: vi.fn(async (_id, _value, verify) => {
        verify();
        return true;
      }),
    };
    const key = generateSyncKey();
    const action = { ownerId: local.id, ownerType: 'host', credential: 'password', key };
    const confirm = vi.fn(async () => true);
    await expect(
      syncCredential(
        { ...action, kind: 'credential-publish' },
        account,
        database,
        vault,
        request,
        async () => false,
      ),
    ).resolves.toEqual({ kind: 'credential-cancelled' });
    expect(vault.getLogin).not.toHaveBeenCalled();
    await expect(
      syncCredential(
        { ...action, kind: 'credential-publish' },
        account,
        database,
        vault,
        request,
        confirm,
      ),
    ).resolves.toEqual({ kind: 'credential-complete', operation: 'publish' });
    expect(JSON.stringify(writes)).not.toContain('server-secret');
    expect(JSON.stringify(writes)).not.toContain('production.example');
    expect(JSON.stringify(writes)).not.toContain(key);
    await expect(
      syncCredential(
        { ...action, kind: 'credential-restore' },
        account,
        database,
        vault,
        request,
        async () => {
          cloud.revision++;
          return true;
        },
      ),
    ).rejects.toThrow('sync-credential-stale');
    expect(vault.restoreSyncedCredential).not.toHaveBeenCalled();
    cloud.revision--;
    await expect(
      syncCredential(
        { ...action, kind: 'credential-restore' },
        account,
        database,
        vault,
        request,
        confirm,
      ),
    ).resolves.toEqual({ kind: 'credential-complete', operation: 'restore' });
    expect(vault.restoreSyncedCredential).toHaveBeenCalledWith(
      local.id,
      { kind: 'password', username: 'operator', password: 'server-secret' },
      expect.any(Function),
    );
    vault.restoreSyncedCredential.mockResolvedValueOnce(false);
    await expect(
      syncCredential(
        { ...action, kind: 'credential-restore' },
        account,
        database,
        vault,
        request,
        confirm,
      ),
    ).rejects.toThrow('sync-credential-exists');
    local.address = 'different.example';
    await expect(
      syncCredential(
        { ...action, kind: 'credential-restore' },
        account,
        database,
        vault,
        request,
        confirm,
      ),
    ).rejects.toThrow('sync-credential-owner');
    const before = request.mock.calls.length;
    vault.vaultStatus.mockResolvedValueOnce({ configured: true, available: true, locked: true });
    await expect(
      syncCredential(
        { ...action, kind: 'credential-remove' },
        account,
        database,
        vault,
        request,
        confirm,
      ),
    ).rejects.toThrow('sync-vault-locked');
    expect(request).toHaveBeenCalledTimes(before);
    await syncCredential(
      { ...action, kind: 'credential-remove' },
      account,
      database,
      vault,
      request,
      confirm,
    );
    await expect(
      syncCredential(
        { ...action, kind: 'credential-restore' },
        account,
        database,
        vault,
        request,
        confirm,
      ),
    ).rejects.toThrow('sync-credential-missing');
  });
});
