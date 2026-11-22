import { createHash } from 'node:crypto';
import { CREDENTIAL_SYNC_ROUTE } from '../../../../../packages/shared/workspace-sync.ts';
import { jumpChain, resolveHost, validHostId } from '../../shared/hosts.js';
import type {
  CredentialKind,
  CredentialOwnerOption,
  SyncPreferenceResult,
} from '../../shared/sync-preferences.js';
import { WorkspaceSyncFailure } from '../../shared/workspace-sync.js';
import { AppFailure } from '../failures.js';
import type { LocalDatabase } from './database.js';
import type { SshSecretStore, SyncCredentialValue } from './secret-store.js';
import {
  decodeSyncKey,
  generateSyncKey,
  openSyncPayload,
  readSyncSnapshot,
  writeSyncPayload,
  type SyncRequest,
} from './workspace-sync.js';

type Profiles = Pick<LocalDatabase, 'listHosts' | 'listHostGroups' | 'listSshIdentities'>;
type Vault = Pick<
  SshSecretStore,
  'vaultStatus' | 'getLogin' | 'getPrivateKey' | 'restoreSyncedCredential'
>;
type Operation = 'publish' | 'restore' | 'remove';
interface CredentialEntry {
  ownerId: string;
  ownerType: CredentialOwnerOption['type'];
  binding: string;
  value: SyncCredentialValue;
}

const catalogLimit = 100;
const slot = ({ ownerType, ownerId, value }: CredentialEntry) =>
  `${ownerType}:${ownerId}:${value.kind}`;
const context = (accountId: string) => JSON.stringify(['mterminal-credential-sync', accountId]);

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readCatalog(raw: unknown): CredentialEntry[] {
  const data = record(raw);
  if (
    !data ||
    data.version !== 1 ||
    !Array.isArray(data.credentials) ||
    data.credentials.length > catalogLimit
  )
    throw new WorkspaceSyncFailure('sync-format');
  const seen = new Set<string>();
  return data.credentials.map((entry: unknown) => {
    const item = record(entry);
    const value = record(item?.value);
    if (
      !item ||
      !value ||
      !validHostId(item.ownerId) ||
      (item.ownerType !== 'host' && item.ownerType !== 'identity') ||
      typeof item.binding !== 'string' ||
      !/^[0-9a-f]{64}$/.test(item.binding)
    )
      throw new WorkspaceSyncFailure('sync-format');
    let credential: SyncCredentialValue;
    if (
      value.kind === 'password' &&
      typeof value.password === 'string' &&
      value.password.length > 0 &&
      value.password.length <= 4096 &&
      (value.username === undefined ||
        (typeof value.username === 'string' &&
          value.username.length > 0 &&
          value.username.length <= 100))
    ) {
      credential = {
        kind: 'password',
        password: value.password,
        ...(typeof value.username === 'string' ? { username: value.username } : {}),
      };
    } else if (
      value.kind === 'key' &&
      item.ownerType === 'identity' &&
      typeof value.privateKey === 'string' &&
      value.privateKey.length > 0 &&
      value.privateKey.length <= 256 * 1024 &&
      typeof value.passphrase === 'string' &&
      value.passphrase.length <= 4096
    ) {
      credential = { kind: 'key', privateKey: value.privateKey, passphrase: value.passphrase };
    } else throw new WorkspaceSyncFailure('sync-format');
    const result = {
      ownerId: item.ownerId,
      ownerType: item.ownerType,
      binding: item.binding,
      value: credential,
    } as CredentialEntry;
    const id = slot(result);
    if (seen.has(id)) throw new WorkspaceSyncFailure('sync-format');
    seen.add(id);
    return result;
  });
}

export function credentialOwners(database: Profiles): CredentialOwnerOption[] {
  return [
    ...database
      .listHosts()
      .map(({ id, name }) => ({ id, type: 'host' as const, label: `Host · ${name}` })),
    ...database
      .listSshIdentities()
      .map(({ id, name }) => ({ id, type: 'identity' as const, label: `Identity · ${name}` })),
  ];
}

function owner(
  database: Profiles,
  id: string,
  type: CredentialOwnerOption['type'],
): { label: string; binding: string } {
  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  if (type === 'identity') {
    const identity = database.listSshIdentities().find((item) => item.id === id);
    if (!identity) throw new WorkspaceSyncFailure('sync-credential-owner');
    return {
      label: `Identity ${identity.name} (${identity.username})`,
      binding: hash([type, id, identity.username, identity.method]),
    };
  }
  const hosts = database.listHosts();
  const host = hosts.find((item) => item.id === id);
  if (!host) throw new WorkspaceSyncFailure('sync-credential-owner');
  const groups = database.listHostGroups();
  const endpoint = (item: typeof host) => {
    const resolved = resolveHost(item, groups);
    return [resolved.address, resolved.port, resolved.username, resolved.identityId ?? null];
  };
  const resolved = resolveHost(host, groups);
  return {
    label: `Host ${host.name} (${resolved.address}:${resolved.port})`,
    binding: hash([type, id, endpoint(host), jumpChain(host, hosts).map(endpoint)]),
  };
}

async function checkVault(vault: Vault): Promise<void> {
  const state = await vault.vaultStatus();
  if (!state.available) throw new WorkspaceSyncFailure('sync-vault-unavailable');
  if (!state.configured || state.locked) throw new WorkspaceSyncFailure('sync-vault-locked');
}

export async function syncCredential(
  action: Record<string, unknown>,
  accountId: string,
  database: Profiles,
  vault: Vault,
  request: SyncRequest,
  confirm: (operation: Operation, label: string, kind: CredentialKind) => Promise<boolean>,
): Promise<SyncPreferenceResult> {
  const salt = context(accountId);
  const { kind, ownerId, ownerType, credential } = action;
  if (kind === 'credential-key') {
    const snapshot = await readSyncSnapshot(request, CREDENTIAL_SYNC_ROUTE, accountId);
    if (snapshot.envelope) throw new WorkspaceSyncFailure('sync-credential-key-exists');
    return { kind, key: generateSyncKey() };
  }
  const operation =
    kind === 'credential-publish'
      ? 'publish'
      : kind === 'credential-restore'
        ? 'restore'
        : kind === 'credential-remove'
          ? 'remove'
          : undefined;
  if (
    !operation ||
    !validHostId(ownerId) ||
    (ownerType !== 'host' && ownerType !== 'identity') ||
    (credential !== 'password' && (credential !== 'key' || ownerType !== 'identity'))
  )
    throw new WorkspaceSyncFailure('invalid-input');
  const profile = owner(database, ownerId, ownerType);
  const verifyOwner = () => {
    if (owner(database, ownerId, ownerType).binding !== profile.binding)
      throw new WorkspaceSyncFailure('sync-credential-owner');
  };
  const key = decodeSyncKey(action.key);
  try {
    await checkVault(vault);
    const snapshot = await readSyncSnapshot(request, CREDENTIAL_SYNC_ROUTE, accountId);
    if (snapshot.envelope && snapshot.envelope.version !== 1)
      throw new WorkspaceSyncFailure('sync-version');
    const catalog = snapshot.envelope
      ? readCatalog(openSyncPayload(snapshot.envelope, key, salt, snapshot.revision))
      : [];
    const index = catalog.findIndex(
      (item) => slot(item) === `${ownerType}:${ownerId}:${credential}`,
    );
    const previous = catalog[index];
    if (operation !== 'publish' && !previous)
      throw new WorkspaceSyncFailure('sync-credential-missing');
    if (operation === 'restore' && previous?.binding !== profile.binding)
      throw new WorkspaceSyncFailure('sync-credential-owner');
    if (!(await confirm(operation, profile.label, credential)))
      return { kind: 'credential-cancelled' };
    verifyOwner();
    if (operation === 'restore') {
      const current = await readSyncSnapshot(request, CREDENTIAL_SYNC_ROUTE, accountId);
      if (
        current.revision !== snapshot.revision ||
        current.envelope?.tag !== snapshot.envelope?.tag
      )
        throw new WorkspaceSyncFailure('sync-credential-stale');
      if (!(await vault.restoreSyncedCredential(ownerId, previous!.value, verifyOwner)))
        throw new WorkspaceSyncFailure('sync-credential-exists');
    } else {
      if (operation === 'remove') catalog.splice(index, 1);
      else {
        let value: SyncCredentialValue;
        if (credential === 'password') {
          const login = await vault.getLogin(ownerId);
          if (!login) throw new WorkspaceSyncFailure('sync-credential-missing');
          value = { kind: 'password', ...login };
        } else {
          const stored = await vault.getPrivateKey(ownerId);
          if (!stored) throw new WorkspaceSyncFailure('sync-credential-missing');
          value = { kind: 'key', ...stored };
        }
        const entry: CredentialEntry = { ownerId, ownerType, binding: profile.binding, value };
        if (index >= 0) catalog[index] = entry;
        else catalog.push(entry);
      }
      if (catalog.length > catalogLimit) throw new WorkspaceSyncFailure('sync-size');
      await checkVault(vault);
      verifyOwner();
      await writeSyncPayload(
        snapshot,
        { version: 1, credentials: catalog },
        key,
        request,
        CREDENTIAL_SYNC_ROUTE,
        salt,
        1,
      );
    }
    return { kind: 'credential-complete', operation };
  } catch (error) {
    if (error instanceof AppFailure && error.code === 'vault-locked')
      throw new WorkspaceSyncFailure('sync-vault-locked');
    if (error instanceof AppFailure && error.code === 'vault-unavailable')
      throw new WorkspaceSyncFailure('sync-vault-unavailable');
    throw error;
  } finally {
    key.fill(0);
  }
}
