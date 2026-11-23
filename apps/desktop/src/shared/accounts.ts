import type {
  AccountErrorCode,
  AccountSummary,
  DeviceDirectoryKey,
} from '../../../../packages/shared/accounts.ts';
import type {
  OrganizationAction,
  OrganizationView,
} from '../../../../packages/shared/organizations.ts';
export { accountPasswordLimits } from '../../../../packages/shared/accounts.ts';

export const ACCOUNT_REQUEST = 'account:request';
export const ORGANIZATION_REQUEST = 'account:organizations';
export type OrganizationResult =
  { ok: true; view: OrganizationView } | { ok: false; code: AccountErrorCode };

export const DEVICE_DIRECTORY_REQUEST = 'account:device-directory';

export type DeviceDirectoryAction =
  | { kind: 'status' }
  | { kind: 'rename-device'; deviceId: string; name: string }
  | { kind: 'retire-device' | 'restore-device'; deviceId: string }
  | { kind: 'publish-device-key'; identityId: string }
  | { kind: 'remove-directory-key'; deviceId: string; identityId: string };

export type DeviceDirectoryResult =
  { ok: true; keys: DeviceDirectoryKey[] } | { ok: false; code: AccountErrorCode };

export type AccountAction =
  | { kind: 'status' | 'sign-out' }
  | { kind: 'register' | 'recover'; email: string }
  | { kind: 'verify'; email: string; password: string; code: string }
  | { kind: 'sign-in'; email: string; password: string; factor?: string }
  | { kind: 'reset'; email: string; password: string; code: string; factor?: string }
  | { kind: 'start-mfa'; password: string }
  | { kind: 'enable-mfa'; factor: string }
  | { kind: 'disable-mfa'; password: string; factor: string }
  | { kind: 'revoke-session'; sessionId: string };

export type AccountState =
  | { status: 'unconfigured' | 'signed-out' }
  | { status: 'offline' }
  | { status: 'signed-in'; account: AccountSummary; retained: boolean };

export type AccountResponse =
  | AccountState
  | { status: 'mfa-setup'; key: string }
  | { status: 'mfa-enabled'; recoveryCodes: string[] };

export type AccountResult =
  { ok: true; state: AccountResponse } | { ok: false; code: AccountErrorCode };

export interface AccountApi {
  organizations: (action: OrganizationAction) => Promise<OrganizationView>;
  deviceDirectory: (action: DeviceDirectoryAction) => Promise<DeviceDirectoryKey[]>;
  account: (action: AccountAction) => Promise<AccountResponse>;
}

export type { AccountSummary, DeviceDirectoryKey, OrganizationAction, OrganizationView };
