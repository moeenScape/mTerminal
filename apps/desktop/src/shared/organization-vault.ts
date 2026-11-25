import { validAccountId, type AccountErrorCode } from '../../../../packages/shared/accounts.ts';
import type {
  VaultAccessAction,
  VaultAccessView,
} from '../../../../packages/shared/organization-vault.ts';
export type {
  VaultDescriptor,
  VaultGrant,
  VaultAccessAction,
  VaultAccessView,
} from '../../../../packages/shared/organization-vault.ts';
import { validSyncRevision } from '../../../../packages/shared/workspace-sync.ts';
import type { WorkspaceBackup } from './backup.js';
import type { Preferences } from './preferences.js';
import type { Snippet } from './snippets.js';

export const VAULT_ACCESS_REQUEST = 'account:vault-access';
export type VaultAccessReply =
  { ok: true; view: VaultAccessView } | { ok: false; code: AccountErrorCode };

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
  | { kind: 'generate-key'; organizationId: string; vaultId: string }
  | { kind: 'open'; organizationId: string; vaultId: string; key: string }
  | {
      kind: 'publish' | 'import';
      organizationId: string;
      vaultId: string;
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
  organizationVaultAccess: (action: VaultAccessAction) => Promise<VaultAccessView>;
  organizationVault: (action: SharedVaultAction) => Promise<SharedVaultView>;
}

export function parseSharedVaultAction(value: unknown): SharedVaultAction | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const { kind, organizationId, vaultId, key, category, revision } = value as Record<
    string,
    unknown
  >;
  if (!validAccountId(organizationId) || !validAccountId(vaultId)) return;
  const ids = { organizationId: organizationId.toLowerCase(), vaultId: vaultId.toLowerCase() };
  const count = Object.keys(value).length;
  if (kind === 'generate-key' && count === 3) return { kind, ...ids };
  if (typeof key !== 'string' || key.length !== ORGANIZATION_VAULT_KEY_PREFIX.length + 43) return;
  if (kind === 'open' && count === 4) return { kind, ...ids, key };
  if (
    (kind === 'publish' || kind === 'import') &&
    count === 6 &&
    typeof category === 'string' &&
    Object.hasOwn(sharedVaultCategories, category) &&
    validSyncRevision(revision)
  )
    return { kind, ...ids, key, category: category as SharedVaultCategory, revision };
}
