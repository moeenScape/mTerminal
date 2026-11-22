export const accountRoutes = {
  register: '/v1/accounts/register',
  verify: '/v1/accounts/verify',
  signIn: '/v1/accounts/sign-in',
  session: '/v1/accounts/session',
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
  email: string;
  currentSessionId: string;
  currentDeviceId: string;
  devices: AccountDevice[];
  sessions: AccountSession[];
}

export const accountErrors = {
  'invalid-input': 'Check the email, password, and verification code and try again.',
  'invalid-code': 'This verification code is invalid or expired. Request a new code.',
  'invalid-login': 'Sign-in failed. Check the email and password or create an account first.',
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
