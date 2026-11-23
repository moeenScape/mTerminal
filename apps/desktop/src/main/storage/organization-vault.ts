import {
  organizationVaultRoute,
  validVaultGrant,
} from '../../../../../packages/shared/organization-vault.ts';
import {
  parseSyncEnvelope,
  validSyncRevision,
} from '../../../../../packages/shared/workspace-sync.ts';
import type { PreferencesStore } from '../preferences.js';
import type { Preferences } from '../../shared/preferences.js';
import { validateSnippetCatalog } from '../../shared/snippets.js';
import {
  ORGANIZATION_VAULT_KEY_PREFIX,
  type SharedVaultAction,
  type SharedVaultDocument,
  type SharedVaultSettings,
  type SharedVaultView,
} from '../../shared/organization-vault.js';
import { syncMetadata, WorkspaceSyncFailure } from '../../shared/workspace-sync.js';
import type { LocalDatabase } from './database.js';
import type { SshSecretStore } from './secret-store.js';
import {
  decodeSyncKey,
  generateSyncKey,
  openSyncPayload,
  writeSyncPayload,
  type SyncRequest,
} from './workspace-sync.js';

export function sharedSettings(preferences: Preferences): SharedVaultSettings {
  const { appearance, navigationShortcuts, autocomplete, copyOnSelect } = preferences;
  return { appearance, navigationShortcuts, autocomplete, copyOnSelect };
}

function readSettings(value: unknown): SharedVaultSettings {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 4
  )
    throw new WorkspaceSyncFailure('sync-format');
  const { appearance, navigationShortcuts, autocomplete, copyOnSelect } = value as Record<
    string,
    unknown
  >;
  if (
    (appearance !== 'dark' && appearance !== 'light') ||
    typeof navigationShortcuts !== 'boolean' ||
    typeof autocomplete !== 'boolean' ||
    typeof copyOnSelect !== 'boolean'
  )
    throw new WorkspaceSyncFailure('sync-format');
  return { appearance, navigationShortcuts, autocomplete, copyOnSelect };
}

export function readSharedVault(value: unknown): SharedVaultDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new WorkspaceSyncFailure('sync-format');
  const data = value as Record<string, unknown>;
  if (
    data.version !== 1 ||
    Object.keys(data).some((key) => !['version', 'workspace', 'snippets', 'settings'].includes(key))
  )
    throw new WorkspaceSyncFailure('sync-format');
  try {
    return {
      version: 1,
      ...(data.workspace !== undefined ? { workspace: syncMetadata(data.workspace) } : {}),
      ...(data.snippets !== undefined
        ? { snippets: validateSnippetCatalog({ version: 1, snippets: data.snippets }).snippets }
        : {}),
      ...(data.settings !== undefined ? { settings: readSettings(data.settings) } : {}),
    };
  } catch {
    throw new WorkspaceSyncFailure('sync-format');
  }
}

export async function sharedVault(
  action: SharedVaultAction,
  request: SyncRequest,
  database: Pick<LocalDatabase, 'exportWorkspace' | 'mergeSyncedWorkspace'>,
  secrets: Pick<SshSecretStore, 'listSnippets' | 'mergeSharedSnippets'>,
  preferences: Pick<PreferencesStore, 'preferences' | 'applyPortableSettings'>,
): Promise<SharedVaultView> {
  const { organizationId, vaultId } = action;
  const route = organizationVaultRoute(organizationId, vaultId);
  const context =
    vaultId === organizationId
      ? `organization-vault:${organizationId}`
      : `organization-vault:${organizationId}:${vaultId}`;
  const snapshot = await request(route, 'GET');
  const { revision, access } = snapshot;
  const envelope = parseSyncEnvelope(snapshot.envelope);
  if (
    snapshot.organizationId !== organizationId ||
    snapshot.vaultId !== vaultId ||
    (access !== 'owner' && !validVaultGrant(access)) ||
    !validSyncRevision(revision) ||
    (revision === 0 ? snapshot.envelope !== null : envelope?.version !== 1)
  )
    throw new WorkspaceSyncFailure('sync-format');
  if (access === 'reader' && (action.kind === 'generate-key' || action.kind === 'publish'))
    throw new WorkspaceSyncFailure('organization-vault-denied');
  if (action.kind === 'generate-key') {
    if (revision !== 0) throw new WorkspaceSyncFailure('sync-exists');
    return { revision, vaultKey: generateSyncKey(ORGANIZATION_VAULT_KEY_PREFIX) };
  }
  const key = decodeSyncKey(action.key, ORGANIZATION_VAULT_KEY_PREFIX);
  try {
    if ('revision' in action && action.revision !== revision)
      throw new WorkspaceSyncFailure('sync-conflict');
    const document: SharedVaultDocument = envelope
      ? readSharedVault(openSyncPayload(envelope, key, context, revision))
      : { version: 1 };
    if (action.kind === 'open') return { revision, document };
    if (action.kind === 'publish') {
      if (action.category === 'workspace')
        document.workspace = syncMetadata(database.exportWorkspace());
      if (action.category === 'snippets') document.snippets = await secrets.listSnippets();
      if (action.category === 'settings')
        document.settings = sharedSettings(preferences.preferences);
      const updated = await writeSyncPayload(
        { revision },
        document,
        key,
        request,
        route,
        context,
        1,
      );
      return { revision: updated, document };
    }
    let imported: number;
    if (action.category === 'workspace' && document.workspace) {
      imported = database.mergeSyncedWorkspace(document.workspace);
    } else if (action.category === 'snippets' && document.snippets) {
      imported = await secrets.mergeSharedSnippets(document.snippets);
    } else if (action.category === 'settings' && document.settings) {
      await preferences.applyPortableSettings(document.settings);
      imported = 1;
    } else {
      throw new WorkspaceSyncFailure('organization-vault-empty');
    }
    return { revision, document, imported };
  } finally {
    key.fill(0);
  }
}
