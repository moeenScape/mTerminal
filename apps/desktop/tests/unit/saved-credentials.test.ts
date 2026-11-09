import { afterEach, describe, expect, it, vi } from 'vitest';
import { findSavedCredentials } from '../../src/renderer/src/features/workspace/saved-credentials.js';
import type { HostGroup, SavedHost, SshIdentity } from '../../src/shared/hosts.js';

const hostId = '04e9f162-d3cd-4c8f-a70a-2323a1751a9b';
const identityId = '14e9f162-d3cd-4c8f-a70a-2323a1751a9b';
afterEach(() => vi.unstubAllGlobals());
function fixture() {
  let host: SavedHost = {
    id: hostId,
    name: 'Fixture',
    address: 'example.internal',
    port: 22037,
    username: '',
    protocol: 'ssh',
    groupPath: '',
    tags: ['production'],
    inheritUsername: true,
  };
  const groups: HostGroup[] = [];
  const identities: SshIdentity[] = [];
  const api = {
    listHosts: vi.fn(async () => [host]),
    listHostGroups: vi.fn(async () => groups),
    listSshIdentities: vi.fn(async () => identities),
    getVaultState: vi.fn(async () => ({ configured: true, locked: false, available: true })),
    getSshPasswordStatus: vi.fn(async (owner: string) => ({
      available: true,
      saved: owner === hostId,
      username: owner === hostId ? 'saved-user' : undefined,
    })),
    getSshKeyStatus: vi.fn(async () => ({ available: true, saved: false })),
  };
  vi.stubGlobal('window', { mterminal: api });
  return {
    api,
    groups,
    identities,
    host: () => host,
    change: (patch: Partial<SavedHost>) => {
      host = { ...host, ...patch };
    },
  };
}
describe('remembered SSH connection defaults', () => {
  it('uses the saved host login without changing profile or shared identity defaults', async () => {
    const state = fixture();
    state.change({ username: 'profile-user', identityId, groupPath: 'Production' });
    state.groups.push({ path: 'Production', username: 'group-user', port: null, identityId: null });
    state.identities.push({
      id: identityId,
      name: 'Shared',
      username: 'shared-user',
      method: 'privateKey',
    });
    const credentials = await findSavedCredentials(hostId);
    expect(credentials).toMatchObject({
      username: 'saved-user',
      useSavedPassword: true,
      savedPasswordIdentityId: hostId,
    });
    expect(credentials).not.toHaveProperty('password');
    expect(state.host().username).toBe('profile-user');
    expect(state.identities[0]?.username).toBe('shared-user');
    expect(state.api.getSshKeyStatus).not.toHaveBeenCalled();
  });
  it('retains legacy password-only lookup with a configured username', async () => {
    const state = fixture();
    state.change({ username: 'legacy-user', inheritUsername: false });
    state.api.getSshPasswordStatus.mockResolvedValue({
      available: true,
      saved: true,
      username: undefined,
    });
    expect(await findSavedCredentials(hostId)).toMatchObject({
      username: 'legacy-user',
      useSavedPassword: true,
    });
    state.change({ username: '' });
    expect(await findSavedCredentials(hostId)).toBeUndefined();
  });
  it('keeps locked or unavailable vault connections out of automatic saved-password lookup', async () => {
    const state = fixture();
    state.change({ username: 'root', inheritUsername: false });
    state.api.getVaultState.mockResolvedValue({ configured: true, locked: true, available: true });
    expect(await findSavedCredentials(hostId)).toBeUndefined();
    state.api.getVaultState.mockResolvedValue({
      configured: true,
      locked: false,
      available: false,
    });
    expect(await findSavedCredentials(hostId)).toBeUndefined();
    expect(state.api.getSshPasswordStatus).not.toHaveBeenCalled();
  });
  it('does not connect a host that has been removed', async () => {
    const state = fixture();
    state.api.listHosts.mockResolvedValue([]);
    expect(await findSavedCredentials(hostId)).toBeUndefined();
    expect(state.api.getSshPasswordStatus).not.toHaveBeenCalled();
  });
});
