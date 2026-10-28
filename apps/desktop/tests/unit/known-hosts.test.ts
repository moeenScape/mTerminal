import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { LocalDatabase } from '../../src/main/storage/database.js';
import { verifyKnownHost } from '../../src/main/terminal/known-hosts.js';
import { keyFingerprint } from '../../src/main/terminal/ssh.js';

async function fixture(operation: (db: LocalDatabase, path: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'mterminal-trust-'));
  const path = join(directory, 'data.sqlite');
  const db = await LocalDatabase.open(path);
  try {
    await operation(db, path);
  } finally {
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
}
const key = Buffer.from('test public key');
const other = Buffer.from('changed public key');
const signal = () => new AbortController().signal;
describe('known host trust', () => {
  it('requires approval for unknown keys and reuses persisted endpoint trust', async () => {
    await fixture(async (db) => {
      const decline = vi.fn(async () => ['cancel']);
      expect(await verifyKnownHost(db, 'Example.com', 22, key, '', signal(), decline)).toBe(false);
      expect(db.getKnownHost('example.com', 22)).toBeUndefined();
      const approve = vi.fn(async () => ['trust']);
      expect(await verifyKnownHost(db, 'Example.com', 22, key, '', signal(), approve)).toBe(true);
      expect(approve.mock.calls).toHaveLength(1);
      const noPrompt = vi.fn(async () => ['cancel']);
      expect(await verifyKnownHost(db, 'example.COM', 22, key, '', signal(), noPrompt)).toBe(true);
      expect(noPrompt).not.toHaveBeenCalled();
      expect(db.getKnownHost('example.com', 2222)).toBeUndefined();
      db.deleteHost(
        db.saveHost({
          name: 'Profile',
          address: 'example.com',
          port: 22,
          username: '',
          protocol: 'ssh',
        }).id,
      );
      expect(db.getKnownHost('example.com', 22)).toBe(keyFingerprint(key));
    });
  });
  it('refuses changed keys, requires exact replacement, and rejects stale approvals', async () => {
    await fixture(async (db) => {
      const oldFingerprint = keyFingerprint(key);
      const newFingerprint = keyFingerprint(other);
      db.trustKnownHost('example.com', 22, oldFingerprint);
      expect(
        await verifyKnownHost(db, 'example.com', 22, other, '', signal(), async () => ['trust']),
      ).toBe(false);
      expect(db.getKnownHost('example.com', 22)).toBe(oldFingerprint);
      expect(
        await verifyKnownHost(db, 'example.com', 22, other, '', signal(), async (question) => {
          expect(question.trust).toMatchObject({
            previous: oldFingerprint,
            fingerprint: newFingerprint,
          });
          return [newFingerprint];
        }),
      ).toBe(false);
      expect(
        await verifyKnownHost(db, 'example.com', 22, other, '', signal(), async () => []),
      ).toBe(true);
      expect(() => db.trustKnownHost('example.com', 22, oldFingerprint)).toThrow();
      expect(() =>
        db.trustKnownHost('example.com', 22, keyFingerprint(Buffer.from('third')), oldFingerprint),
      ).toThrow();
    });
  });
  it('enforces explicit pins and cancellation without saving trust', async () => {
    await fixture(async (db) => {
      const ask = vi.fn(async () => ['trust']);
      expect(
        await verifyKnownHost(db, 'example.com', 22, key, keyFingerprint(other), signal(), ask),
      ).toBe(false);
      expect(ask).not.toHaveBeenCalled();
      const controller = new AbortController();
      expect(
        await verifyKnownHost(db, 'example.com', 22, key, '', controller.signal, async () => {
          controller.abort();
          return ['trust'];
        }),
      ).toBe(false);
      expect(db.getKnownHost('example.com', 22)).toBeUndefined();
      await expect(
        verifyKnownHost(db, 'example.com', 22, key, '', signal(), async () => {
          db.trustKnownHost('example.com', 22, keyFingerprint(other));
          return ['trust'];
        }),
      ).rejects.toMatchObject({ code: 'ssh-key-mismatch' });
    });
  });
  it('upgrades v3 without changing saved profiles and persists trust across reopen', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mterminal-trust-upgrade-'));
    let db: LocalDatabase | undefined;
    try {
      const path = join(directory, 'data.sqlite');
      db = await LocalDatabase.open(path);
      const host = db.saveHost({
        name: 'Existing',
        address: 'example.com',
        port: 22,
        username: 'ops',
        protocol: 'ssh',
      });
      db.transaction((connection) =>
        connection.exec(
          'DROP TABLE known_hosts; DELETE FROM schema_migrations WHERE version=4; PRAGMA user_version=3;',
        ),
      );
      db.close();
      db = undefined;
      db = await LocalDatabase.open(path);
      expect(db.listHosts()).toEqual([host]);
      db.trustKnownHost('example.com', 22, keyFingerprint(key));
      db.close();
      db = undefined;
      db = await LocalDatabase.open(path);
      expect(db.getKnownHost('example.com', 22)).toBe(keyFingerprint(key));
    } finally {
      db?.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
