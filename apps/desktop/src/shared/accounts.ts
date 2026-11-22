import type { AccountErrorCode, AccountSummary } from '../../../../packages/shared/accounts.ts';
export { accountPasswordLimits } from '../../../../packages/shared/accounts.ts';

export const ACCOUNT_REQUEST = 'account:request';

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
  | { status: 'signed-in'; account: AccountSummary; retained: boolean };

export type AccountResponse =
  | AccountState
  | { status: 'mfa-setup'; key: string }
  | { status: 'mfa-enabled'; recoveryCodes: string[] };

export type AccountResult =
  { ok: true; state: AccountResponse } | { ok: false; code: AccountErrorCode };

export interface AccountApi {
  account: (action: AccountAction) => Promise<AccountResponse>;
}
