import type { AccountErrorCode } from '../../../../packages/shared/accounts.ts';

export const SYNC_PREFERENCES_REQUEST = 'sync-preferences:request';

export interface SyncPreferences {
  metadata: boolean;
  credentials: boolean;
}

export type CredentialKind = 'password' | 'key';

export interface CredentialOwnerOption {
  id: string;
  type: 'host' | 'identity';
  label: string;
}

export type SyncPreferenceAction =
  | { kind: 'status' | 'credential-key' }
  | { kind: 'set-category'; category: keyof SyncPreferences; enabled: boolean }
  | {
      kind: 'credential-publish' | 'credential-restore' | 'credential-remove';
      ownerId: string;
      ownerType: CredentialOwnerOption['type'];
      credential: CredentialKind;
      key: string;
    };

export type SyncPreferenceResult =
  | { kind: 'preferences'; preferences: SyncPreferences; owners: CredentialOwnerOption[] }
  | { kind: 'credential-key'; key: string }
  | { kind: 'credential-cancelled' }
  | { kind: 'credential-complete'; operation: 'publish' | 'restore' | 'remove' };

export type SyncPreferenceReply =
  { ok: true; result: SyncPreferenceResult } | { ok: false; code: AccountErrorCode };

export interface SyncPreferencesApi {
  syncPreferences: (action: SyncPreferenceAction) => Promise<SyncPreferenceResult>;
}
