import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { SshSecretStore, type SafeStorageProvider } from '../../src/main/storage/secret-store.js';
import { utils } from 'ssh2';

const identityId = '04e9f162-d3cd-4c8f-a70a-2323a1751a9b';
function fakeStorage(backend = 'gnome_libsecret'): SafeStorageProvider {
  return {
    isAsyncEncryptionAvailable: async () => true,
    getSelectedStorageBackend: () => backend,
    encryptStringAsync: async (value) =>
      Buffer.concat([
        Buffer.from('enc:'),
        Buffer.from([...Buffer.from(value)].map((byte) => byte ^ 0xaa)),
      ]),
    decryptStringAsync: async (encrypted) => ({
      result:
        encrypted.subarray(0, 4).toString() === 'enc:'
          ? Buffer.from([...encrypted.subarray(4)].map((byte) => byte ^ 0xaa)).toString()
          : (() => {
              throw new Error('invalid ciphertext');
            })(),
      shouldReEncrypt: false,
    }),
  };
}

describe('OS-encrypted SSH password storage', () => {
  it('stores ciphertext separately, retrieves it and removes it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mterminal-vault-'));
    try {
      const store = new SshSecretStore(join(directory, 'vault'), fakeStorage(), 'linux');
      await store.savePassword(identityId, 'secret-password');
      const path = join(directory, 'vault', `${identityId}.password.enc`);
      const encrypted = await readFile(path);
      expect(encrypted.toString()).not.toContain('secret-password');
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect(await store.passwordStatus(identityId)).toEqual({ available: true, saved: true });
      expect(await store.getPassword(identityId)).toBe('secret-password');
      await store.deletePassword(identityId);
      expect(await store.passwordStatus(identityId)).toEqual({ available: true, saved: false });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('refuses the basic_text Linux fallback and preserves previous data on failed encryption', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mterminal-vault-'));
    try {
      const insecure = new SshSecretStore(
        join(directory, 'insecure'),
        fakeStorage('basic_text'),
        'linux',
      );
      await expect(insecure.savePassword(identityId, 'never-written')).rejects.toMatchObject({
        code: 'vault-unavailable',
      });
      await expect(readdir(join(directory, 'insecure'))).rejects.toMatchObject({ code: 'ENOENT' });

      const provider = fakeStorage();
      const store = new SshSecretStore(join(directory, 'secure'), provider, 'linux');
      await store.savePassword(identityId, 'kept-password');
      vi.mocked(provider.encryptStringAsync).mockRejectedValueOnce(
        new Error('keychain unavailable'),
      );
      await expect(store.savePassword(identityId, 'replacement')).rejects.toThrow();
      expect(await store.getPassword(identityId)).toBe('kept-password');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects malformed identity references and treats broken ciphertext as unavailable', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mterminal-vault-'));
    try {
      const store = new SshSecretStore(join(directory, 'vault'), fakeStorage(), 'linux');
      await expect(store.getPassword('../identity')).rejects.toThrow('Invalid identity ID.');
      await store.savePassword(identityId, 'secret-password');
      await writeFile(join(directory, 'vault', `${identityId}.password.enc`), 'broken');
      await expect(store.getPassword(identityId)).rejects.toMatchObject({
        code: 'vault-unavailable',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('OS-encrypted SSH key storage', () => {
  it('stores a private key and passphrase only as ciphertext and removes it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mterminal-key-vault-'));
    try {
      const store = new SshSecretStore(join(directory, 'vault'), fakeStorage(), 'linux');
      const pair = utils.generateKeyPairSync('ed25519');
      await store.savePrivateKey(identityId, pair.private);
      const path = join(directory, 'vault', `${identityId}.key.enc`);
      const encrypted = await readFile(path);
      expect(encrypted.toString()).not.toContain(pair.private);
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect(await store.getPrivateKey(identityId)).toEqual({
        privateKey: pair.private,
        passphrase: '',
      });
      expect(await store.privateKeyStatus(identityId)).toEqual({ available: true, saved: true });
      await store.deletePrivateKey(identityId);
      expect(await store.privateKeyStatus(identityId)).toEqual({ available: true, saved: false });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects an invalid key or passphrase and preserves the prior stored key', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mterminal-key-vault-'));
    try {
      const store = new SshSecretStore(join(directory, 'vault'), fakeStorage(), 'linux');
      const pair = utils.generateKeyPairSync('ed25519');
      await store.savePrivateKey(identityId, pair.private);
      await expect(store.savePrivateKey(identityId, 'not a private key')).rejects.toThrow();
      expect((await store.getPrivateKey(identityId))?.privateKey).toBe(pair.private);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('generates an encrypted RSA key when a passphrase is supplied', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mterminal-key-vault-'));
    try {
      const store = new SshSecretStore(join(directory, 'vault'), fakeStorage(), 'linux');
      await store.generatePrivateKey(identityId, 'key-passphrase');
      expect(await store.getPrivateKey(identityId)).toMatchObject({ passphrase: 'key-passphrase' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
