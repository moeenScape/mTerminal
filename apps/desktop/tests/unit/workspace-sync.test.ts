import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { LocalDatabase } from '../../src/main/storage/database.js';
import {
  decodeSyncKey,
  decryptWorkspace,
  encryptWorkspace,
  generateSyncKey,
  publishWorkspace,
  syncWorkspace,
} from '../../src/main/storage/workspace-sync.js';
import {
  WorkspacePublication,
  WorkspacePublicationRunner,
} from '../../src/main/storage/workspace-publication.js';
import { WorkspaceSyncFailure } from '../../src/shared/workspace-sync.js';
import type { WorkspaceBackup } from '../../src/shared/backup.js';
import type { SavedHost } from '../../src/shared/hosts.js';
import {
  WORKSPACE_SYNC_ROUTE,
  type SyncSnapshot,
} from '../../../../packages/shared/workspace-sync.ts';

const accountId = randomUUID();
const host = (name: string): SavedHost => ({
  id: randomUUID(),
  name,
  protocol: 'ssh',
  address: `${name.toLowerCase()}.example.com`,
  port: 22,
  username: 'operator',
});
const backup = (hosts: SavedHost[] = []): WorkspaceBackup => ({
  format: 'mterminal-workspace',
  version: 1,
  exportedAt: '2026-11-22T00:00:00Z',
  hosts,
  groups: [],
  identities: [],
  knownHosts: [],
});

describe('encrypted workspace sync', () => {
  it('authenticates the account and revision and omits device-specific or sensitive values', () => {
    const first = host('First');
    const key = decodeSyncKey(generateSyncKey());
    const data: WorkspaceBackup = {
      ...backup([
        {
          ...first,
          environment: [{ name: 'TOKEN', value: 'example-secret' }],
          useAgent: true,
          agentForwarding: true,
          proxyId: randomUUID(),
        },
      ]),
      groups: [
        {
          path: 'Operations',
          port: null,
          username: null,
          environment: [{ name: 'TOKEN', value: 'group-secret' }],
        },
      ],
      knownHosts: [{ address: first.address, port: 22, fingerprint: 'SHA256:' + 'x'.repeat(43) }],
    };
    const encrypted = encryptWorkspace(data, key, accountId, 1);
    expect(encryptWorkspace(data, key, accountId, 1).nonce).not.toBe(encrypted.nonce);
    const decoded = decryptWorkspace(encrypted, key, accountId, 1);
    expect(decoded.hosts[0]).toMatchObject(first);
    expect(decoded.hosts[0]).not.toHaveProperty('environment');
    expect(decoded.hosts[0]).not.toHaveProperty('useAgent');
    expect(decoded.hosts[0]).not.toHaveProperty('agentForwarding');
    expect(decoded.hosts[0]).not.toHaveProperty('proxyId');
    expect(decoded.groups[0]).not.toHaveProperty('environment');
    expect(decoded.knownHosts).toEqual([]);
    expect(() =>
      decryptWorkspace(encrypted, decodeSyncKey(generateSyncKey()), accountId, 1),
    ).toThrow('sync-key');
    expect(() => decryptWorkspace(encrypted, key, randomUUID(), 1)).toThrow('sync-key');
    expect(() => decryptWorkspace(encrypted, key, accountId, 2)).toThrow('sync-key');
    const changed = (encrypted.tag.startsWith('A') ? 'B' : 'A') + encrypted.tag.slice(1);
    expect(() => decryptWorkspace({ ...encrypted, tag: changed }, key, accountId, 1)).toThrow(
      'sync-key',
    );
  });

  it('publishes a union, skips repeated writes, and refuses an incompatible key or overlapping edit', async () => {
    const first = host('First');
    const other = host('Second');
    const key = generateSyncKey();
    const bytes = decodeSyncKey(key);
    const snapshot: SyncSnapshot = {
      accountId,
      revision: 1,
      envelope: encryptWorkspace(backup([first]), bytes, accountId, 1),
    };
    const database = {
      exportWorkspace: vi.fn(() => backup([other])),
      mergeSyncedWorkspace: vi.fn(() => 0),
    };
    const put = vi.fn(
      (body: {
        expectedRevision: number;
        envelope: NonNullable<SyncSnapshot['envelope']>;
        writeProof: string;
      }) => {
        expect(body.expectedRevision).toBe(1);
        expect(body.writeProof).not.toBe(key);
        expect(JSON.stringify(body)).not.toContain(key);
        expect(
          decryptWorkspace(body.envelope, bytes, accountId, 2).hosts.map(({ id }) => id),
        ).toEqual([first.id, other.id]);
        snapshot.revision = 2;
        snapshot.envelope = body.envelope;
        return { revision: 2 };
      },
    );
    const request = async (path: string, method: 'GET' | 'PUT', payload?: object) => {
      expect(path).toBe(WORKSPACE_SYNC_ROUTE);
      return method === 'GET' ? { ...snapshot } : put(payload as Parameters<typeof put>[0]);
    };
    await expect(syncWorkspace({ kind: 'publish', key }, database, request)).resolves.toEqual({
      kind: 'published',
      revision: 2,
      count: 1,
    });
    await expect(syncWorkspace({ kind: 'publish', key }, database, request)).resolves.toEqual({
      kind: 'published',
      revision: 2,
      count: 0,
    });
    await expect(
      syncWorkspace({ kind: 'publish', key: generateSyncKey() }, database, request),
    ).rejects.toThrow('sync-key');
    database.exportWorkspace.mockReturnValue(backup([{ ...other, name: 'Locally edited' }]));
    await expect(syncWorkspace({ kind: 'publish', key }, database, request)).rejects.toThrow(
      'sync-record-conflict',
    );
    expect(put).toHaveBeenCalledTimes(1);
  });

  it('merges additions referencing existing rows and leaves local-only fields intact', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mterminal-sync-'));
    const database = await LocalDatabase.open(join(directory, 'workspace.sqlite'));
    try {
      const first = database.saveHost({
        ...host('First'),
        environment: [{ name: 'TOKEN', value: 'local-only' }],
      });
      const second = { ...host('Second'), jumpHostId: first.id };
      const source = backup([{ ...first, environment: [] }, second]);
      expect(database.mergeSyncedWorkspace(source)).toBe(1);
      expect(database.mergeSyncedWorkspace(source)).toBe(0);
      expect(database.listHosts().find((entry) => entry.id === first.id)?.environment).toEqual([
        { name: 'TOKEN', value: 'local-only' },
      ]);
      expect(database.listHosts().find((entry) => entry.id === second.id)?.jumpHostId).toBe(
        first.id,
      );
      const third = host('Third');
      expect(() =>
        database.mergeSyncedWorkspace(backup([third, { ...first, name: 'Different' }])),
      ).toThrow('sync-record-conflict');
      expect(database.listHosts().some((entry) => entry.id === third.id)).toBe(false);
    } finally {
      database.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('queued workspace publication', () => {
  it('persists encrypted metadata, coalesces later edits, and isolates each account and origin', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mterminal-publication-'));
    try {
      const key = decodeSyncKey(generateSyncKey());
      const original = host('Original');
      const removedLocally = host('OnlyQueued');
      const storage = new WorkspacePublication(directory, 'https://account.example', accountId);
      await storage.enqueue(backup([original, removedLocally]), key);
      const before = await readFile(storage.path, 'utf8');
      expect(before).not.toContain(original.address);
      expect(before).not.toContain(key.toString('base64url'));
      const reopened = new WorkspacePublication(directory, 'https://account.example', accountId);
      const wrong = decodeSyncKey(generateSyncKey());
      await expect(reopened.enqueue(backup([host('Another')]), wrong)).rejects.toThrow('sync-key');
      expect(await readFile(storage.path, 'utf8')).toBe(before);
      await reopened.enqueue(backup([{ ...original, name: 'Updated' }]), key);
      const saved = await reopened.snapshot(key);
      expect(saved?.hosts.map((item) => item.name)).toEqual(['Updated', 'OnlyQueued']);
      expect(
        await new WorkspacePublication(directory, 'https://other.example', accountId).pending(),
      ).toBe(false);
      expect(
        await new WorkspacePublication(
          directory,
          'https://account.example',
          randomUUID(),
        ).pending(),
      ).toBe(false);
      await reopened.remove();
      expect(await storage.pending()).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('retries a captured batch after reconnection and recognizes a write whose reply was lost', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mterminal-publication-'));
    const storage = new WorkspacePublication(directory, 'https://account.example', accountId);
    const record = host('Batch');
    const cloud: SyncSnapshot = { accountId, revision: 0, envelope: null };
    const uploaded = vi.fn();
    let finish!: () => void;
    const retried = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const runner = new WorkspacePublicationRunner(
      storage,
      (data, key) =>
        publishWorkspace(
          data,
          key,
          async (_path, method, body) => {
            if (method === 'GET') return { ...cloud };
            const input = body as { envelope: NonNullable<SyncSnapshot['envelope']> };
            cloud.revision = 1;
            cloud.envelope = input.envelope;
            uploaded();
            throw new WorkspaceSyncFailure('unavailable');
          },
          accountId,
        ),
      async (run) => {
        await run();
        finish();
      },
      () => {},
    );
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const key = generateSyncKey();
      const initial = backup([record]);
      await expect(runner.start(key, initial)).resolves.toEqual({
        kind: 'queue-status',
        queue: { status: 'retrying' },
      });
      expect(await storage.pending()).toBe(true);
      initial.hosts.push(host('EditedAfterQueue'));
      await vi.advanceTimersByTimeAsync(30_000);
      await retried;
      expect(uploaded).toHaveBeenCalledTimes(1);
      expect(
        decryptWorkspace(cloud.envelope!, decodeSyncKey(key), accountId, 1).hosts.map(
          ({ id }) => id,
        ),
      ).toEqual([record.id]);
      expect(await storage.pending()).toBe(false);
    } finally {
      runner.dispose();
      vi.useRealTimers();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
