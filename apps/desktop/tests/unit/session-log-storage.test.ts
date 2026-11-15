import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { SshSecretStore, type SafeStorageProvider } from '../../src/main/storage/secret-store.js';
import { LOG_RETENTION_MS, type SessionLog } from '../../src/shared/session-logs.js';
function log(): SessionLog {
  const now = Date.now();
  return {
    id: randomUUID(),
    sessionId: randomUUID(),
    title: 'Local',
    createdAt: now,
    updatedAt: now,
    text: 'private output\nnext line',
    notes: '',
    bookmarks: [],
    reason: 'stopped',
  };
}
async function fixture(
  operation: (
    store: SshSecretStore,
    directory: string,
    storage: SafeStorageProvider,
  ) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), 'mterminal-session-logs-'));
  const storage: SafeStorageProvider = {
    isAsyncEncryptionAvailable: async () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptStringAsync: async (value) => Buffer.from(value),
    decryptStringAsync: async (value) => ({ result: value.toString(), shouldReEncrypt: false }),
  };
  const store = new SshSecretStore(directory, storage, 'linux');
  try {
    await store.setupVault('session log test passphrase');
    await operation(store, directory, storage);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
describe('encrypted session log persistence', () => {
  it('preserves annotations across lock/restart and archives logs on vault reset', async () => {
    await fixture(async (store, directory, storage) => {
      const saved = log();
      await store.saveSessionLog(saved);
      const bookmark = { id: randomUUID(), offset: 15, comment: 'Check this' };
      await store.annotateSessionLog(saved.id, { notes: 'Review', bookmarks: [bookmark] });
      expect(await readFile(join(directory, 'session-logs.enc'), 'utf8')).not.toContain(
        'private output',
      );
      await store.lockVault();
      await expect(store.listSessionLogs()).rejects.toMatchObject({ code: 'vault-locked' });
      const reopened = new SshSecretStore(directory, storage, 'linux');
      await reopened.unlockVault('session log test passphrase');
      expect(await reopened.listSessionLogs()).toEqual([
        { ...saved, notes: 'Review', bookmarks: [bookmark] },
      ]);
      await reopened.resetVault();
      const recovery = (await readdir(directory)).find((name) => name.startsWith('recovery-'))!;
      expect(await readdir(join(directory, recovery))).toContain('session-logs.enc');
    });
  });
  it('refuses quota overflow without eviction and prunes expired logs on access', async () => {
    await fixture(async (store) => {
      const saved = Array.from({ length: 4 }, log);
      for (const item of saved) await store.saveSessionLog(item);
      await expect(store.saveSessionLog(log())).rejects.toThrow();
      expect(await store.listSessionLogs()).toHaveLength(4);
      await store.deleteSessionLog(saved[0]!.id);
      expect(await store.listSessionLogs()).toHaveLength(3);
      const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + LOG_RETENTION_MS + 1);
      try {
        expect(await store.listSessionLogs()).toEqual([]);
      } finally {
        clock.mockRestore();
      }
    });
  });
  it('preserves the previous ciphertext after encryption failure and rejects invalid annotations', async () => {
    await fixture(async (store, directory, storage) => {
      const saved = log();
      await store.saveSessionLog(saved);
      const before = await readFile(join(directory, 'session-logs.enc'));
      const encrypt = vi
        .spyOn(storage, 'encryptStringAsync')
        .mockRejectedValueOnce(new Error('private backend failure'));
      await expect(store.saveSessionLog({ ...saved, text: 'new text' })).rejects.toThrow();
      encrypt.mockRestore();
      expect(await readFile(join(directory, 'session-logs.enc'))).toEqual(before);
      expect(await store.listSessionLogs()).toEqual([saved]);
      await expect(
        store.annotateSessionLog(saved.id, {
          notes: '',
          bookmarks: [{ id: randomUUID(), offset: 99999, comment: '' }],
        }),
      ).rejects.toThrow();
      expect(await store.listSessionLogs()).toEqual([saved]);
    });
  });
});
