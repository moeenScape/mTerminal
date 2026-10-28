import { failureMessages, type FailureCode } from '../shared/failures.ts';

export class AppFailure extends Error {
  readonly code: FailureCode;
  constructor(code: FailureCode) {
    super(failureMessages[code]);
    this.code = code;
  }
}

export function failureCode(error: unknown, fallback: FailureCode): FailureCode {
  if (error instanceof AppFailure) return error.code;
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (
    code === 'ERR_SQLITE_ERROR' &&
    error &&
    typeof error === 'object' &&
    'errcode' in error &&
    typeof error.errcode === 'number'
  ) {
    // SQLite extended result codes retain the primary code in the low eight bits.
    const primary = error.errcode & 0xff;
    if (primary === 11 || primary === 26) return 'database-invalid';
    if (primary === 13) return 'disk-full';
    if (primary === 3 || primary === 8) return 'permission-denied';
    if (primary === 5 || primary === 6) return 'database-locked';
  }
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return 'permission-denied';
  if (code === 'ENOSPC' || code === 'EDQUOT') return 'disk-full';
  if (code === 'ENOTSUP' || code === 'EOPNOTSUPP' || code === 'EXDEV') return 'backup-unsupported';
  return fallback;
}
