import { resolveHost } from '../../../../shared/hosts';
import { validateSshCredentials, type SshCredentials } from '../../../../shared/ssh';

/**
 * Credentials for a one-click connection, when nothing needs typing: the identity's managed
 * private key, or a password saved for the host or its identity. Returns undefined when the
 * user must be asked (no username, nothing saved, or the vault is not open).
 */
export async function findSavedCredentials(hostId: string): Promise<SshCredentials | undefined> {
  const [hosts, groups, identities, vault] = await Promise.all([
    window.mterminal.listHosts(),
    window.mterminal.listHostGroups(),
    window.mterminal.listSshIdentities(),
    window.mterminal.getVaultState(),
  ]);
  const host = hosts.find((item) => item.id === hostId);
  if (!host || !vault.configured || vault.locked || !vault.available) return undefined;
  const resolved = resolveHost(host, groups);
  const identity = identities.find((item) => item.id === resolved.identityId);
  const username = identity?.username || resolved.username;
  if (!username) return undefined;
  const base = { username, fingerprint: '', keyboardInteractive: false };

  if (identity?.method === 'privateKey') {
    const key = await window.mterminal.getSshKeyStatus(identity.id);
    if (key.available && key.saved)
      return validateSshCredentials({
        ...base,
        method: 'privateKey',
        useSavedPrivateKey: true,
        savedPrivateKeyIdentityId: identity.id,
      });
  }
  if (identity?.method === 'keyboard-interactive') return undefined;
  // The host's own password wins over one shared through its identity.
  for (const owner of [host.id, identity?.id]) {
    if (!owner) continue;
    const status = await window.mterminal.getSshPasswordStatus(owner);
    if (status.available && status.saved)
      return validateSshCredentials({
        ...base,
        method: 'password',
        useSavedPassword: true,
        savedPasswordIdentityId: owner,
      });
  }
  return undefined;
}
