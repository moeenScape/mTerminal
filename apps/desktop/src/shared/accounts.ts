import type { AccountErrorCode, AccountSummary } from '../../../../packages/shared/accounts.ts';
export { accountPasswordLimits } from '../../../../packages/shared/accounts.ts';

export const ACCOUNT_REQUEST = 'account:request';

export type AccountAction =
  | { kind: 'status' | 'sign-out' }
  | { kind: 'register'; email: string }
  | { kind: 'verify'; email: string; password: string; code: string }
  | { kind: 'sign-in'; email: string; password: string };

export type AccountState =
  | { status: 'unconfigured' | 'signed-out' }
  | { status: 'signed-in'; account: AccountSummary; retained: boolean };

export type AccountResult =
  { ok: true; state: AccountState } | { ok: false; code: AccountErrorCode };

export interface AccountApi {
  account: (action: AccountAction) => Promise<AccountState>;
}
