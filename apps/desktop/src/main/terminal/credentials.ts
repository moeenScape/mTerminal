import type { SshCredentials } from '../../shared/ssh.js';
import { validateSshCredentials } from '../../shared/ssh.js';
import { AppFailure } from '../failures.js';
import type { SshSecretStore } from '../storage/secret-store.js';

export async function resolveSshCredentials(
  value: unknown,
  assignedIdentityId: string | null | undefined,
  secrets: SshSecretStore,
  /** The host being connected; its own saved password may be used. */
  hostId?: string,
): Promise<SshCredentials> {
  const credentials = validateSshCredentials(value);
  if (credentials.useSavedPrivateKey) {
    const identityId = credentials.savedPrivateKeyIdentityId;
    if (!identityId || assignedIdentityId !== identityId)
      throw new AppFailure('vault-secret-missing');
    const key = await secrets.getPrivateKey(identityId);
    if (!key) throw new AppFailure('vault-secret-missing');
    return {
      username: credentials.username,
      method: 'privateKey',
      keyboardInteractive: credentials.keyboardInteractive === true,
      fingerprint: credentials.fingerprint,
      ...key,
    };
  }
  if (!credentials.useSavedPassword) return credentials;
  const identityId = credentials.savedPasswordIdentityId;
  if (!identityId || (identityId !== assignedIdentityId && identityId !== hostId))
    throw new AppFailure('vault-secret-missing');
  const password = await secrets.getPassword(identityId);
  if (!password) throw new AppFailure('vault-secret-missing');
  return {
    username: credentials.username,
    method: credentials.method ?? 'password',
    keyboardInteractive: credentials.keyboardInteractive === true,
    fingerprint: credentials.fingerprint,
    password,
  };
}
