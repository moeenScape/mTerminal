import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Secret, TOTP } from 'otpauth';

export const newAuthenticatorKey = (): string => new Secret({ size: 20 }).base32;

export function authenticatorStep(
  secret: string,
  token: string,
  timestamp = Date.now(),
): number | undefined {
  if (!/^\d{6}$/.test(token)) return undefined;
  const totp = new TOTP({
    secret: Secret.fromBase32(secret),
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  });
  const delta = totp.validate({ token, timestamp, window: 1 });
  return delta === null ? undefined : totp.counter({ timestamp }) + delta;
}

export function sealAuthenticator(key: Buffer, account: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(account));
  const value = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), value]).toString('base64url');
}

export function openAuthenticator(key: Buffer, account: string, value: string): string {
  const bytes = Buffer.from(value, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(account));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
}
