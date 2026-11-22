export const accountRoutes = {
  register: '/v1/accounts/register',
  verify: '/v1/accounts/verify',
  signIn: '/v1/accounts/sign-in',
  session: '/v1/accounts/session',
  protection: '/v1/accounts/protection',
  recover: '/v1/accounts/recover',
  reset: '/v1/accounts/reset',
} as const;

export interface AccountDevice {
  id: string;
  name: string;
  lastSignedInAt: string;
}

export interface AccountSession {
  id: string;
  deviceId: string;
  createdAt: string;
  expiresAt: string;
}

export interface AccountSummary {
  accountId?: string;
  email: string;
  mfaEnabled: boolean;
  currentSessionId: string;
  currentDeviceId: string;
  devices: AccountDevice[];
  sessions: AccountSession[];
}

export const accountErrors = {
  'invalid-input': 'Check the email, password, and verification code and try again.',
  'invalid-code': 'This verification code is invalid or expired. Request a new code.',
  'invalid-login': 'Sign-in failed. Check the email and password or create an account first.',
  'mfa-required': 'Enter a code from your authenticator app or a recovery code.',
  'invalid-factor': 'The authenticator or recovery code is invalid or has already been used.',
  'mfa-state':
    'The authenticator setup has expired or changed. Refresh Account settings and try again.',
  'session-missing': 'That session has already ended. Refresh the list of active sessions.',
  'sync-conflict': 'The sync copy changed during publication. Try publishing again.',
  'sync-record-conflict':
    'A host, group, or identity differs between copies. Open Review differences before syncing.',
  'sync-key': 'Enter the correct workspace sync key. The encrypted copy could not be opened.',
  'sync-format': 'The workspace sync payload is invalid or uses an unsupported version.',
  'sync-size': 'The workspace sync copy exceeds the 1 MiB limit.',
  'sync-empty': 'There is no workspace data to sync for this operation.',
  'sync-exists': 'This account already has an encrypted workspace copy. Use its existing sync key.',
  'sync-queue-empty': 'There is no publication queued for this account.',
  'sync-review-stale':
    'The workspace or cloud copy changed. Open a new review before applying changes.',
  'sync-dependencies':
    'The selected changes leave a missing or invalid group, identity, or jump host. Review the related records together.',
  'sync-local-protected':
    'A selected deletion would remove device-specific settings or a stored credential. Review it in Hosts before deleting it.',
  'sync-version': 'This workspace copy requires a compatible version of mTerminal.',
  'sync-queue-storage': 'The saved workspace publication could not be read or written.',
  'sync-account-unverified':
    'Connect to the account service once to enable offline workspace publication.',
  'sign-in-required': 'Your account session has ended. Sign in again.',
  'rate-limited': 'Too many attempts. Wait a minute and try again.',
  unavailable: 'The account service is unavailable. Try again in a moment.',
} as const;
export type AccountErrorCode = keyof typeof accountErrors;

export const accountPasswordLimits = { min: 15, max: 128 } as const;

export function normalizeAccountEmail(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 254) return undefined;
  const email = value.trim().toLowerCase();
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(email)) return undefined;
  const [local, domain] = email.split('@');
  if (
    !local ||
    local.length > 64 ||
    local.startsWith('.') ||
    local.endsWith('.') ||
    local.includes('..')
  )
    return undefined;
  if (
    domain
      ?.split('.')
      .some((label) => label.startsWith('-') || label.endsWith('-') || label.length > 63)
  )
    return undefined;
  return email;
}

export function validAccountPassword(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= accountPasswordLimits.min &&
    value.length <= accountPasswordLimits.max
  );
}

export function validAccountToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function validSecondFactor(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[0-9]{6}|[a-f0-9]{32})$/i.test(value);
}

export function validAccountId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}
