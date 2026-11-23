import { validAccountId, type AccountErrorCode } from '../../../../packages/shared/accounts.ts';
import { validSyncRevision } from '../../../../packages/shared/workspace-sync.ts';
import type { WorkspaceBackup } from './backup.js';
import type { Preferences } from './preferences.js';
import type { Snippet } from './snippets.js';

export const ORGANIZATION_VAULT_REQUEST = 'account:organization-vault';
export const ORGANIZATION_VAULT_KEY_PREFIX = 'mterminal-org-v1_';

export const sharedVaultErrors: Partial<Record<AccountErrorCode, string>> = {
  'sync-key': 'Enter the correct key for this shared vault.',
  'sync-exists': 'This shared vault already has a key. Use it to open the vault.',
  'sync-conflict': 'The shared vault changed. Open it again before retrying.',
  'sync-vault-locked': 'Unlock your local SSH vault to share or add snippets.',
};

export const sharedVaultCategories = {
  workspace: 'Hosts and identities',
  snippets: 'Snippets',
  settings: 'Settings',
} as const;
export type SharedVaultCategory = keyof typeof sharedVaultCategories;
export type SharedVaultSettings = Pick<
  Preferences,
  'appearance' | 'navigationShortcuts' | 'autocomplete' | 'copyOnSelect'
>;

export interface SharedVaultDocument {
  version: 1;
  workspace?: WorkspaceBackup;
  snippets?: Snippet[];
  settings?: SharedVaultSettings;
}

export type SharedVaultAction =
  | { kind: 'generate-key'; organizationId: string }
  | { kind: 'open'; organizationId: string; key: string }
  | {
      kind: 'publish' | 'import';
      organizationId: string;
      key: string;
      category: SharedVaultCategory;
      revision: number;
    };

export interface SharedVaultView {
  revision: number;
  document?: SharedVaultDocument;
  vaultKey?: string;
  imported?: number;
}

export type SharedVaultReply =
  { ok: true; view: SharedVaultView } | { ok: false; code: AccountErrorCode };

export interface SharedVaultApi {
  organizationVault: (action: SharedVaultAction) => Promise<SharedVaultView>;
}

export function parseSharedVaultAction(value: unknown): SharedVaultAction | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const { kind, organizationId, key, category, revision } = value as Record<string, unknown>;
  if (!validAccountId(organizationId)) return;
  const id = organizationId.toLowerCase();
  const count = Object.keys(value).length;
  if (kind === 'generate-key' && count === 2) return { kind, organizationId: id };
  if (typeof key !== 'string' || key.length !== ORGANIZATION_VAULT_KEY_PREFIX.length + 43) return;
  if (kind === 'open' && count === 3) return { kind, organizationId: id, key };
  if (
    (kind === 'publish' || kind === 'import') &&
    count === 5 &&
    typeof category === 'string' &&
    Object.hasOwn(sharedVaultCategories, category) &&
    validSyncRevision(revision)
  )
    return { kind, organizationId: id, key, category: category as SharedVaultCategory, revision };
}
