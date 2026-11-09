import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  findSavedCredentials,
  rememberMissingUsername,
} from '../../src/renderer/src/features/workspace/saved-credentials.js';
import type { HostDraft, HostGroup, SavedHost, SshIdentity } from '../../src/shared/hosts.js';

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
    saveHost: vi.fn(async (draft: HostDraft, id?: string) => {
      host = { ...draft, id: id! };
      return host;
    }),
    getVaultState: vi.fn(async () => ({ configured: true, locked: false, available: true })),
    getSshPasswordStatus: vi.fn(async (owner: string) => ({
      available: true,
      saved: owner === hostId,
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
  it('fills a missing username and enables host-scoped saved-password reconnect without exposing the secret', async () => {
    const state = fixture();
    expect(await findSavedCredentials(hostId)).toBeUndefined();
    await rememberMissingUsername(hostId, 'root');
    expect(state.host()).toMatchObject({
      username: 'root',
      inheritUsername: false,
      port: 22037,
      tags: ['production'],
    });
    expect(state.api.saveHost).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'root' }),
      hostId,
    );
    const credentials = await findSavedCredentials(hostId);
    expect(credentials).toMatchObject({
      username: 'root',
      useSavedPassword: true,
      savedPasswordIdentityId: hostId,
    });
    expect(credentials).not.toHaveProperty('password');
    expect(state.api.saveHost.mock.calls[0]?.[0]).not.toHaveProperty('password');
  });
  it('leaves explicit, inherited and shared-identity usernames untouched', async () => {
    const state = fixture();
    state.change({ username: 'existing', inheritUsername: false });
    await rememberMissingUsername(hostId, 'root');
    state.change({ username: '', inheritUsername: true, groupPath: 'Production' });
    state.groups.push({ path: 'Production', username: 'group-user', port: null, identityId: null });
    await rememberMissingUsername(hostId, 'root');
    state.change({ groupPath: '', identityId });
    state.identities.push({
      id: identityId,
      name: 'Shared',
      username: 'shared-user',
      method: 'password',
    });
    await rememberMissingUsername(hostId, 'root');
    expect(state.api.saveHost).not.toHaveBeenCalled();
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
  it('does not recreate a host that disappeared before remembering its username', async () => {
    const state = fixture();
    state.api.listHosts.mockResolvedValue([]);
    await expect(rememberMissingUsername(hostId, 'root')).rejects.toThrow('no longer exists');
    expect(state.api.saveHost).not.toHaveBeenCalled();
  });
});
