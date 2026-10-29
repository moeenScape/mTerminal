import type { SshCredentials } from '../../shared/ssh.js';
import { validateSshCredentials } from '../../shared/ssh.js';
import { AppFailure } from '../failures.js';
import type { SshSecretStore } from '../storage/secret-store.js';

export async function resolveSshCredentials(
  value: unknown,
  assignedIdentityId: string | null | undefined,
  secrets: SshSecretStore,
): Promise<SshCredentials> {
  const credentials = validateSshCredentials(value);
  if (!credentials.useSavedPassword) return credentials;
  const identityId = credentials.savedPasswordIdentityId;
  if (!identityId || assignedIdentityId !== identityId)
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
