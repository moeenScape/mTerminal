import { describe, expect, it, vi } from 'vitest';
import { resolveSshCredentials } from '../../src/main/terminal/credentials.js';
import type { SshSecretStore } from '../../src/main/storage/secret-store.js';

const identityId = '04e9f162-d3cd-4c8f-a70a-2323a1751a9b';

describe('saved SSH password resolution', () => {
  it('retrieves a saved password in main and binds it to the assigned identity', async () => {
    const secrets = {
      getPassword: vi.fn().mockResolvedValue('main-only-password'),
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
    expect(secrets.getPassword).toHaveBeenCalledWith(identityId);
  });

  it('rejects stale identity references and missing saved passwords', async () => {
    const secrets = {
      getPassword: vi.fn().mockResolvedValue(undefined),
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
    expect(secrets.getPassword).not.toHaveBeenCalled();
    await expect(resolveSshCredentials(request, identityId, secrets)).rejects.toMatchObject({
      code: 'vault-secret-missing',
    });
  });
});
