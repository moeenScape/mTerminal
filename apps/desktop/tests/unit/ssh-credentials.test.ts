import { describe, expect, it, vi } from 'vitest';
import { resolveSshCredentials } from '../../src/main/terminal/credentials.js';
import type { SshSecretStore } from '../../src/main/storage/secret-store.js';

const identityId = '04e9f162-d3cd-4c8f-a70a-2323a1751a9b';

describe('saved SSH password resolution', () => {
  it('retrieves a saved password in main and binds it to the assigned identity', async () => {
    const secrets = {
      getLogin: vi.fn().mockResolvedValue({ password: 'main-only-password' }),
    } as unknown as SshSecretStore;
    const credentials = await resolveSshCredentials(
      {
        username: 'deploy',
        method: 'password',
        useSavedPassword: true,
        savedPasswordIdentityId: identityId,
        fingerprint: '',
      },
      identityId,
      secrets,
    );
    expect(credentials.password).toBe('main-only-password');
    expect(credentials).not.toHaveProperty('useSavedPassword');
    expect(secrets.getLogin).toHaveBeenCalledWith(identityId);
  });

  it("uses the connecting host's own saved password, but not another host's", async () => {
    const hostId = '9d6f0a51-2b1c-4b7e-8f3a-6c2d1e0b9a77';
    const secrets = {
      getLogin: vi.fn().mockResolvedValue({ username: 'saved-user', password: 'host-password' }),
    } as unknown as SshSecretStore;
    const request = {
      username: 'deploy',
      method: 'password',
      useSavedPassword: true,
      savedPasswordIdentityId: hostId,
      fingerprint: '',
    };
    const credentials = await resolveSshCredentials(request, null, secrets, hostId);
    expect(credentials.password).toBe('host-password');
    expect(credentials.username).toBe('saved-user');
    expect(secrets.getLogin).toHaveBeenCalledWith(hostId);
    await expect(resolveSshCredentials(request, null, secrets, identityId)).rejects.toMatchObject({
      code: 'vault-secret-missing',
    });
  });

  it('rejects stale identity references and missing saved passwords', async () => {
    const secrets = {
      getLogin: vi.fn().mockResolvedValue(undefined),
    } as unknown as SshSecretStore;
    const request = {
      username: 'deploy',
      method: 'password',
      useSavedPassword: true,
      savedPasswordIdentityId: identityId,
      fingerprint: '',
    };
    await expect(resolveSshCredentials(request, null, secrets)).rejects.toMatchObject({
      code: 'vault-secret-missing',
    });
    expect(secrets.getLogin).not.toHaveBeenCalled();
    await expect(resolveSshCredentials(request, identityId, secrets)).rejects.toMatchObject({
      code: 'vault-secret-missing',
    });
  });
});

describe('saved SSH key resolution', () => {
  it('loads a managed key in main and binds it to the assigned identity', async () => {
    const key = { privateKey: 'private-key', passphrase: 'key-passphrase' };
    const secrets = { getPrivateKey: vi.fn().mockResolvedValue(key) } as unknown as SshSecretStore;
    const credentials = await resolveSshCredentials(
      {
        username: 'deploy',
        method: 'privateKey',
        useSavedPrivateKey: true,
        savedPrivateKeyIdentityId: identityId,
        fingerprint: '',
      },
      identityId,
      secrets,
    );
    expect(credentials).toMatchObject({ ...key, method: 'privateKey' });
    expect(credentials).not.toHaveProperty('useSavedPrivateKey');
    expect(secrets.getPrivateKey).toHaveBeenCalledWith(identityId);
  });

  it('rejects a managed key reference for a different identity', async () => {
    const secrets = { getPrivateKey: vi.fn() } as unknown as SshSecretStore;
    await expect(
      resolveSshCredentials(
        {
          username: 'deploy',
          method: 'privateKey',
          useSavedPrivateKey: true,
          savedPrivateKeyIdentityId: identityId,
          fingerprint: '',
        },
        null,
        secrets,
      ),
    ).rejects.toMatchObject({ code: 'vault-secret-missing' });
    expect(secrets.getPrivateKey).not.toHaveBeenCalled();
  });
});
