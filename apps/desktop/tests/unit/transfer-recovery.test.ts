import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { LocalDatabase } from '../../src/main/storage/database.js';
import { TransferRecoveryStore } from '../../src/main/files/transfer-recovery.js';
import { TransferQueue } from '../../src/main/files/transfer-queue.js';
import { FileBrowserError } from '../../src/main/files/listing.js';
import type { TerminalRegistry } from '../../src/main/terminal/registry.js';
import type { TransferCheckpoint, TransferRecoveryRecord } from '../../src/shared/transfers.js';

const record = (): TransferRecoveryRecord => ({
  id: randomUUID(),
  sessionId: randomUUID(),
  title: 'Recovery fixture',
  direction: 'upload',
  localDirectory: tmpdir(),
  remoteDirectory: '/remote',
  name: 'file.txt',
  state: 'running',
  phase: 'staging',
  partialPath: '/remote/.mterminal-fixture.part',
  backupPath: null,
  source: null,
  destination: null,
  peer: {
    address: 'example.com',
    port: 22,
    username: 'deploy',
    fingerprint: `SHA256:${'a'.repeat(43)}`,
  },
  updatedAt: new Date().toISOString(),
});

async function fixture(run: (db: LocalDatabase, directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'mterminal-recovery-'));
  const database = await LocalDatabase.open(join(directory, 'workspace.sqlite'));
  try {
    await run(database, directory);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
}

describe('durable transfer evidence', () => {
  it('restores interrupted evidence without replay, and forgetting never deletes a file', async () => {
    await fixture(async (db, directory) => {
      const store = new TransferRecoveryStore(db);
      const saved = {
        ...record(),
        direction: 'download' as const,
        partialPath: join(directory, 'owned.part'),
      };
      await writeFile(saved.partialPath, 'recovery bytes');
      store.save(saved);
      const snapshot = await db.createBackup(join(directory, 'snapshots'));
      const reopened = await LocalDatabase.open(snapshot);
      try {
        const restored = new TransferRecoveryStore(reopened);
        expect(restored.list()).toEqual([saved]);
        expect(JSON.stringify(reopened.exportWorkspace())).not.toContain('recovery bytes');
        expect(reopened.exportWorkspace()).not.toHaveProperty('transferRecovery');
        const copy = vi.fn();
        const queue = new TransferQueue(
          { onSessionClosed: () => () => {}, transferFile: copy } as unknown as TerminalRegistry,
          () => {},
          restored,
        );
        try {
          expect(queue.list()).toEqual([]);
          queue.clearFinished();
          expect(queue.listRecovery()).toEqual([saved]);
          expect(copy).not.toHaveBeenCalled();
          queue.forgetRecovery(saved.id);
          expect(restored.list()).toEqual([]);
          expect(await readFile(saved.partialPath, 'utf8')).toBe('recovery bytes');
        } finally {
          queue.dispose();
        }
      } finally {
        reopened.close();
      }
    });
  });

  it('migrates schema 5 without losing existing workspace metadata', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mterminal-recovery-migration-'));
    const path = join(directory, 'workspace.sqlite');
    let db: LocalDatabase | undefined;
    try {
      db = await LocalDatabase.open(path);
      const workspace = db.workspaceId;
      const host = db.saveHost({
        name: 'Preserved host',
        address: 'example.com',
        port: 22,
        username: 'deploy',
        protocol: 'ssh',
      });
      db.transaction((connection) =>
        connection.exec(
          'DROP TABLE transfer_recovery; DELETE FROM schema_migrations WHERE version=6; PRAGMA user_version=5;',
        ),
      );
      db.close();
      db = undefined;
      db = await LocalDatabase.open(path);
      expect(db.workspaceId).toBe(workspace);
      expect(db.listHosts()).toContainEqual(host);
      expect(new TransferRecoveryStore(db).list()).toEqual([]);
    } finally {
      db?.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('preserves malformed evidence and refuses to start new transfers', async () => {
    await fixture(async (db) => {
      const original = record();
      db.transaction((connection) =>
        connection
          .prepare('INSERT INTO transfer_recovery VALUES (?,?)')
          .run(original.id, '{broken'),
      );
      const store = new TransferRecoveryStore(db);
      expect(() => store.list()).toThrow('recovery-unavailable');
      const transfer = vi.fn();
      const queue = new TransferQueue(
        {
          onSessionClosed: () => () => {},
          canTransfer: () => true,
          transferFile: transfer,
        } as unknown as TerminalRegistry,
        () => {},
        store,
      );
      try {
        const { sessionId, title, direction, localDirectory, remoteDirectory, name } = original;
        expect(() =>
          queue.enqueue({ sessionId, title, direction, localDirectory, remoteDirectory, name }),
        ).toThrow('recovery-unavailable');
        expect(queue.list()).toEqual([]);
        expect(transfer).not.toHaveBeenCalled();
        expect(
          db.transaction((connection) =>
            connection.prepare('SELECT data FROM transfer_recovery').get(),
          )?.data,
        ).toBe('{broken');
      } finally {
        queue.dispose();
      }
    });
  });

  it('never evicts earlier evidence when recovery storage is full', async () => {
    await fixture(async (db) => {
      const entries = Array.from({ length: 256 }, record);
      db.transaction((connection) => {
        const insert = connection.prepare('INSERT INTO transfer_recovery VALUES (?,?)');
        for (const entry of entries) insert.run(entry.id, JSON.stringify(entry));
      });
      const store = new TransferRecoveryStore(db);
      expect(() => store.save(record())).toThrow('recovery-full');
      expect(store.list()).toHaveLength(256);
      store.save({ ...entries[0]!, phase: 'publishing' });
      expect(store.list().find((entry) => entry.id === entries[0]!.id)?.phase).toBe('publishing');
      store.forget(entries[0]!.id);
      store.save(record());
      expect(store.list()).toHaveLength(256);
    });
  });

  it('keeps planned paths when recording a completed outcome fails', async () => {
    await fixture(async (db) => {
      const store = new TransferRecoveryStore(db);
      const save = vi.spyOn(store, 'save');
      let failFinal = false;
      const realSave = store.save.bind(store);
      save.mockImplementation((value) => {
        if (failFinal) throw new FileBrowserError('recovery-unavailable');
        realSave(value);
      });
      const original = record();
      const queue = new TransferQueue(
        {
          onSessionClosed: () => () => {},
          canTransfer: () => true,
          transferFile: async (
            _id: string,
            _job: unknown,
            _signal: AbortSignal,
            _progress: unknown,
            _approval: unknown,
            checkpoint: (value: TransferCheckpoint) => void,
          ) => {
            checkpoint({
              phase: 'publishing',
              partialPath: '/remote/possible.part',
              backupPath: '/remote/possible.bak',
              source: null,
              destination: null,
            });
            failFinal = true;
            return { partialPath: null, backupPath: '/remote/possible.bak' };
          },
        } as unknown as TerminalRegistry,
        () => {},
        store,
      );
      try {
        const { sessionId, title, direction, localDirectory, remoteDirectory, name } = original;
        queue.enqueue({ sessionId, title, direction, localDirectory, remoteDirectory, name });
        await vi.waitFor(() => expect(queue.list()[0]?.state).toBe('uncertain'));
        expect(store.list()[0]).toMatchObject({
          phase: 'publishing',
          partialPath: '/remote/possible.part',
          backupPath: '/remote/possible.bak',
        });
      } finally {
        queue.dispose();
      }
    });
  });
});
