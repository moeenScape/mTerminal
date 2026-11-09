import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { SshSecretStore, type SafeStorageProvider } from '../../src/main/storage/secret-store.js';
import { utils } from 'ssh2';

const identityId = '04e9f162-d3cd-4c8f-a70a-2323a1751a9b';
const vaultPassphrase = 'a sufficiently long vault passphrase';
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
      await store.setupVault(vaultPassphrase);
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
      await expect(insecure.setupVault(vaultPassphrase)).rejects.toMatchObject({
        code: 'vault-unavailable',
      });
      await expect(readdir(join(directory, 'insecure'))).rejects.toMatchObject({ code: 'ENOENT' });

      const provider = fakeStorage();
      const store = new SshSecretStore(join(directory, 'secure'), provider, 'linux');
      await store.setupVault(vaultPassphrase);
      await store.savePassword(identityId, 'kept-password');
      vi.spyOn(provider, 'encryptStringAsync').mockRejectedValueOnce(
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
      await store.setupVault(vaultPassphrase);
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

describe('host-specific saved logins', () => {
  it('keeps a username/password pair encrypted across restart, replaces it together, and forgets both formats', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mterminal-login-'));
    try {
      const provider = fakeStorage();
      const store = new SshSecretStore(directory, provider, 'linux');
      await store.setupVault(vaultPassphrase);
      await store.savePassword(identityId, 'legacy-password');
      await store.saveLogin(identityId, 'saved-user', 'saved-password');
      const path = join(directory, `${identityId}.login.enc`);
      const encrypted = await readFile(path);
      expect(encrypted.toString()).not.toContain('saved-user');
      expect(encrypted.toString()).not.toContain('saved-password');
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      const restarted = new SshSecretStore(directory, provider, 'linux');
      await expect(restarted.getLogin(identityId)).rejects.toMatchObject({ code: 'vault-locked' });
      await restarted.unlockVault(vaultPassphrase);
      expect(await restarted.getLogin(identityId)).toEqual({
        username: 'saved-user',
        password: 'saved-password',
      });
      expect(await restarted.passwordStatus(identityId)).toEqual({
        available: true,
        saved: true,
        username: 'saved-user',
      });
      vi.spyOn(provider, 'encryptStringAsync').mockRejectedValueOnce(
        new Error('keychain unavailable'),
      );
      await expect(
        restarted.saveLogin(identityId, 'other-user', 'other-password'),
      ).rejects.toThrow();
      expect(await restarted.getLogin(identityId)).toEqual({
        username: 'saved-user',
        password: 'saved-password',
      });
      await restarted.saveLogin(identityId, 'other-user', 'other-password');
      expect(await restarted.getLogin(identityId)).toEqual({
        username: 'other-user',
        password: 'other-password',
      });
      await restarted.savePassword(identityId, 'updated-password');
      expect(await restarted.getLogin(identityId)).toEqual({
        username: 'other-user',
        password: 'updated-password',
      });
      await restarted.deletePassword(identityId);
      expect(await restarted.getLogin(identityId)).toBeUndefined();
      expect((await readdir(directory)).filter((name) => name.endsWith('.enc'))).toEqual([]);
      await restarted.saveLogin(identityId, 'recovery-user', 'recovery-password');
      await restarted.resetVault();
      const recovery = (await readdir(directory)).find((name) => name.startsWith('recovery-'));
      expect(recovery).toBeDefined();
      expect(await readdir(join(directory, recovery!))).toContain(`${identityId}.login.enc`);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('does not fall back to a stale password when the saved login is corrupt', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mterminal-login-'));
    try {
      const store = new SshSecretStore(directory, fakeStorage(), 'linux');
      await store.setupVault(vaultPassphrase);
      await store.savePassword(identityId, 'legacy-password');
      expect(await store.getLogin(identityId)).toEqual({ password: 'legacy-password' });
      await store.saveLogin(identityId, 'saved-user', 'saved-password');
      await writeFile(join(directory, `${identityId}.login.enc`), 'broken');
      await expect(store.getLogin(identityId)).rejects.toMatchObject({ code: 'vault-corrupt' });
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
      await store.setupVault(vaultPassphrase);
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
      const status = await store.privateKeyStatus(identityId);
      expect(status).toMatchObject({ available: true, saved: true });
      expect(status.publicKey).toMatch(/^ssh-ed25519 /);
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
      await store.setupVault(vaultPassphrase);
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
      await store.setupVault(vaultPassphrase);
      await store.generatePrivateKey(identityId, 'key-passphrase');
      expect(await store.getPrivateKey(identityId)).toMatchObject({ passphrase: 'key-passphrase' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('vault passphrase and lock lifecycle', () => {
  it('migrates legacy secrets and requires the passphrase after lock and restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mterminal-vault-lock-'));
    const vaultDirectory = join(directory, 'vault');
    try {
      const provider = fakeStorage();
      await mkdir(vaultDirectory, { recursive: true });
      await writeFile(
        join(vaultDirectory, `${identityId}.password.enc`),
        await provider.encryptStringAsync('legacy-password'),
      );
      const store = new SshSecretStore(vaultDirectory, provider, 'linux');
      await store.setupVault(vaultPassphrase);
      expect(await store.getPassword(identityId)).toBe('legacy-password');
      const migrated = await provider.decryptStringAsync(
        await readFile(join(vaultDirectory, `${identityId}.password.enc`)),
      );
      expect(migrated.result).toContain('mterminal-v1:');

      await store.lockVault();
      expect(await store.vaultStatus()).toMatchObject({ configured: true, locked: true });
      await expect(store.getPassword(identityId)).rejects.toMatchObject({ code: 'vault-locked' });
      await expect(store.unlockVault('a different long passphrase')).rejects.toMatchObject({
        code: 'vault-passphrase-wrong',
      });
      await store.unlockVault(vaultPassphrase);
      expect(await store.getPassword(identityId)).toBe('legacy-password');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('locks new stores by default and rejects weak passphrases', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mterminal-vault-lock-'));
    try {
      const store = new SshSecretStore(join(directory, 'vault'), fakeStorage(), 'linux');
      expect(await store.vaultStatus()).toMatchObject({ configured: false, locked: false });
      await expect(store.setupVault('too short')).rejects.toMatchObject({
        code: 'vault-passphrase-weak',
      });
      await expect(store.savePassword(identityId, 'session-only')).rejects.toMatchObject({
        code: 'vault-locked',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('resets a forgotten vault without deleting its encrypted source files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mterminal-vault-reset-'));
    const vaultDirectory = join(directory, 'vault');
    try {
      const store = new SshSecretStore(vaultDirectory, fakeStorage(), 'linux');
      await store.setupVault(vaultPassphrase);
      await store.savePassword(identityId, 'secret-password');
      await store.resetVault();
      expect(await store.vaultStatus()).toMatchObject({ configured: false, locked: false });
      expect(await readdir(vaultDirectory)).toHaveLength(1);
      const recoveryDirectory = join(vaultDirectory, (await readdir(vaultDirectory))[0]!);
      expect((await readdir(recoveryDirectory)).sort()).toEqual(
        ['vault.master', `${identityId}.password.enc`].sort(),
      );
      await store.setupVault('a new sufficiently long passphrase');
      expect(await store.getPassword(identityId)).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('encrypted snippet storage', () => {
  it('persists editable snippets as ciphertext, refuses locked reads, and retains them across restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mterminal-snippets-'));
    try {
      const provider = fakeStorage();
      const store = new SshSecretStore(directory, provider, 'linux');
      await store.setupVault(vaultPassphrase);
      const draft = {
        name: 'Deploy',
        command: 'echo PRIVATE_SNIPPET',
        folder: 'Work',
        tags: ['deploy'],
      };
      const saved = await store.saveSnippet(draft);
      const encrypted = await readFile(join(directory, 'snippets.enc'));
      expect(encrypted.toString()).not.toContain('PRIVATE_SNIPPET');
      expect(encrypted.toString()).not.toContain('Deploy');
      expect((await stat(join(directory, 'snippets.enc'))).mode & 0o777).toBe(0o600);
      await store.lockVault();
      await expect(store.listSnippets()).rejects.toMatchObject({ code: 'vault-locked' });
      const reopened = new SshSecretStore(directory, provider, 'linux');
      await reopened.unlockVault(vaultPassphrase);
      expect(await reopened.listSnippets()).toEqual([saved]);
      const updated = await reopened.saveSnippet(
        { ...draft, command: 'echo updated', folder: 'Work/Production' },
        saved.id,
      );
      expect(updated.id).toBe(saved.id);
      expect(await reopened.listSnippets()).toEqual([updated]);
      await reopened.deleteSnippet(saved.id);
      expect(await reopened.listSnippets()).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('preserves previous snippets on failed writes, duplicate names and corrupt ciphertext', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mterminal-snippets-'));
    try {
      const provider = fakeStorage();
      const store = new SshSecretStore(directory, provider, 'linux');
      await store.setupVault(vaultPassphrase);
      const draft = { name: 'Kept', command: 'echo kept', folder: '', tags: [] };
      const saved = await store.saveSnippet(draft);
      vi.spyOn(provider, 'encryptStringAsync').mockRejectedValueOnce(new Error('keychain failure'));
      await expect(
        store.saveSnippet({ ...draft, command: 'echo changed' }, saved.id),
      ).rejects.toThrow();
      expect(await store.listSnippets()).toEqual([saved]);
      await expect(store.saveSnippet({ ...draft, name: 'kept' })).rejects.toThrow();
      expect(await store.listSnippets()).toEqual([saved]);
      await writeFile(join(directory, 'snippets.enc'), 'broken');
      await expect(store.listSnippets()).rejects.toMatchObject({ code: 'vault-corrupt' });
      await expect(store.saveSnippet({ ...draft, name: 'New' })).rejects.toMatchObject({
        code: 'vault-corrupt',
      });
      expect(await readFile(join(directory, 'snippets.enc'), 'utf8')).toBe('broken');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('enforces the snippet count and refuses insecure keychain fallback without replacing data', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mterminal-snippets-'));
    try {
      const provider = fakeStorage();
      const store = new SshSecretStore(directory, provider, 'linux');
      await store.setupVault(vaultPassphrase);
      for (let n = 0; n < 200; n++)
        await store.saveSnippet({ name: `Snippet ${n}`, command: 'echo ok', folder: '', tags: [] });
      await expect(
        store.saveSnippet({ name: 'Overflow', command: 'echo no', folder: '', tags: [] }),
      ).rejects.toMatchObject({ code: 'snippet-limit' });
      const before = await readFile(join(directory, 'snippets.enc'));
      vi.spyOn(provider, 'getSelectedStorageBackend').mockReturnValue('basic_text');
      await expect(store.listSnippets()).rejects.toMatchObject({ code: 'vault-unavailable' });
      expect(await readFile(join(directory, 'snippets.enc'))).toEqual(before);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('preserves snippet ciphertext in the recovery folder on vault reset', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mterminal-snippets-'));
    try {
      const store = new SshSecretStore(directory, fakeStorage(), 'linux');
      await store.setupVault(vaultPassphrase);
      await store.saveSnippet({ name: 'Recovery', command: 'echo recover', folder: '', tags: [] });
      const before = await readFile(join(directory, 'snippets.enc'));
      await store.resetVault();
      const recovery = (await readdir(directory)).find((name) => name.startsWith('recovery-'));
      expect(await readFile(join(directory, recovery!, 'snippets.enc'))).toEqual(before);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('encrypted startup snippet assignments', () => {
  it('keeps host/local bindings across restart and updates, and removes bindings with deleted snippets', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mterminal-startup-'));
    try {
      const provider = fakeStorage();
      const store = new SshSecretStore(directory, provider, 'linux');
      await store.setupVault(vaultPassphrase);
      const draft = { name: 'Startup', command: 'echo STARTUP_PRIVATE', folder: '', tags: [] };
      const snippet = await store.saveSnippet(draft);
      await store.setStartupSnippet('local', snippet.id);
      await store.setStartupSnippet(identityId, snippet.id);
      const ciphertext = await readFile(join(directory, 'snippets.enc'));
      expect(ciphertext.toString()).not.toContain('STARTUP_PRIVATE');
      expect(ciphertext.toString()).not.toContain(identityId);
      const reopened = new SshSecretStore(directory, provider, 'linux');
      await reopened.unlockVault(vaultPassphrase);
      expect(await reopened.getStartupSnippet('local')).toEqual(snippet);
      expect(await reopened.getStartupSnippet(identityId)).toEqual(snippet);
      await reopened.saveSnippet({ ...draft, command: 'echo updated' }, snippet.id);
      expect((await reopened.getStartupSnippet(identityId))?.command).toBe('echo updated');
      vi.spyOn(provider, 'encryptStringAsync').mockRejectedValueOnce(new Error('failed write'));
      await expect(reopened.setStartupSnippet('local', null)).rejects.toThrow();
      expect((await reopened.getStartupSnippet('local'))?.id).toBe(snippet.id);
      await reopened.setStartupSnippet('local', null);
      expect(await reopened.getStartupSnippet('local')).toBeNull();
      await reopened.deleteSnippet(snippet.id);
      expect(await reopened.getStartupSnippet(identityId)).toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
