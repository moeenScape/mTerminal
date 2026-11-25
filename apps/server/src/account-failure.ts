import type { AccountErrorCode } from '../../../packages/shared/accounts.ts';

export class AccountFailure extends Error {
  readonly code: AccountErrorCode;

  constructor(code: AccountErrorCode) {
    super(code);
    this.code = code;
  }
}
