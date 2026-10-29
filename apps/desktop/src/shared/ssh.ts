import { validHostId } from './hosts.js';

export interface SshCredentials {
  username: string;
  method?: 'password' | 'privateKey' | 'keyboard-interactive';
  password?: string;
  privateKey?: string;
  passphrase?: string;
  keyboardInteractive?: boolean;
  fingerprint: string;
  useSavedPassword?: boolean;
  savedPasswordIdentityId?: string;
  useSavedPrivateKey?: boolean;
  savedPrivateKeyIdentityId?: string;
}
export function validateSshCredentials(value: unknown): SshCredentials {
  if (!value || typeof value !== 'object') throw new Error('Invalid SSH credentials.');
  const c = value as SshCredentials;
  if (
    typeof c.username !== 'string' ||
    !c.username.trim() ||
    c.username.length > 100 ||
    /\s/.test(c.username) ||
    Array.from(c.username).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
    c.username.startsWith('-') ||
    typeof c.fingerprint !== 'string' ||
    (c.fingerprint !== '' && !validFingerprint(c.fingerprint))
  )
    throw new Error('Invalid SSH credentials.');
  const method = c.method ?? 'password';
  if (
    (c.useSavedPassword !== undefined && typeof c.useSavedPassword !== 'boolean') ||
    (c.savedPasswordIdentityId !== undefined && typeof c.savedPasswordIdentityId !== 'string') ||
    (c.useSavedPrivateKey !== undefined && typeof c.useSavedPrivateKey !== 'boolean') ||
    (c.savedPrivateKeyIdentityId !== undefined && typeof c.savedPrivateKeyIdentityId !== 'string')
  )
    throw new Error('Invalid saved credential reference.');
  if (
    !['password', 'privateKey', 'keyboard-interactive'].includes(method) ||
    (c.keyboardInteractive !== undefined && typeof c.keyboardInteractive !== 'boolean')
  )
    throw new Error('Invalid authentication method.');
  const base = {
    username: c.username,
    fingerprint: c.fingerprint,
    method,
    keyboardInteractive: c.keyboardInteractive === true,
  };
  if (method === 'password') {
    if (c.useSavedPrivateKey || c.savedPrivateKeyIdentityId !== undefined)
      throw new Error('Invalid saved key reference.');
    if (c.useSavedPassword === true) {
      if (
        c.password !== undefined ||
        typeof c.savedPasswordIdentityId !== 'string' ||
        !validHostId(c.savedPasswordIdentityId)
      )
        throw new Error('Invalid saved credential reference.');
      return {
        ...base,
        useSavedPassword: true,
        savedPasswordIdentityId: c.savedPasswordIdentityId,
      };
    }
    if (c.savedPasswordIdentityId !== undefined)
      throw new Error('Invalid saved credential reference.');
    if (typeof c.password !== 'string' || c.password.length > 4096)
      throw new Error('Invalid password.');
    return { ...base, password: c.password };
  }
  if (c.useSavedPassword || c.savedPasswordIdentityId !== undefined)
    throw new Error('Invalid saved credential reference.');
  if (
    method !== 'privateKey' &&
    (c.useSavedPrivateKey || c.savedPrivateKeyIdentityId !== undefined)
  )
    throw new Error('Invalid saved key reference.');
  if (method === 'privateKey') {
    if (c.useSavedPrivateKey === true) {
      if (
        c.privateKey !== undefined ||
        c.passphrase !== undefined ||
        typeof c.savedPrivateKeyIdentityId !== 'string' ||
        !validHostId(c.savedPrivateKeyIdentityId)
      )
        throw new Error('Invalid saved key reference.');
      return {
        ...base,
        useSavedPrivateKey: true,
        savedPrivateKeyIdentityId: c.savedPrivateKeyIdentityId,
      };
    }
    if (c.useSavedPrivateKey || c.savedPrivateKeyIdentityId !== undefined)
      throw new Error('Invalid saved key reference.');
    if (
      typeof c.privateKey !== 'string' ||
      !c.privateKey.trim() ||
      c.privateKey.length > 256 * 1024 ||
      (c.passphrase !== undefined &&
        (typeof c.passphrase !== 'string' || c.passphrase.length > 4096))
    )
      throw new Error('Invalid key.');
    return { ...base, privateKey: c.privateKey, passphrase: c.passphrase ?? '' };
  }
  return base;
}

export function validFingerprint(value: unknown): value is string {
  return typeof value === 'string' && /^SHA256:[A-Za-z0-9+/]{43}$/.test(value);
}

export function formatSshPublicKey(type: string, blob: Uint8Array, comment = ''): string {
  const base64 = btoa(Array.from(blob, (byte) => String.fromCharCode(byte)).join(''));
  const safeComment = Array.from(comment)
    .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 256);
  return `${type} ${base64}${safeComment ? ` ${safeComment}` : ''}`;
}
export interface HostKeyRequest {
  address: string;
  port: number;
  fingerprint: string;
  previous?: string;
}
export interface SshQuestion {
  trust?: HostKeyRequest;
  title: string;
  instructions: string;
  prompts: { prompt: string; echo: boolean }[];
}
export interface SshChallenge extends SshQuestion {
  id: string;
  token: string;
}
export function validateSshQuestion(value: SshQuestion): SshQuestion {
  if (
    typeof value.title !== 'string' ||
    value.title.length > 256 ||
    typeof value.instructions !== 'string' ||
    value.instructions.length > 2048 ||
    !Array.isArray(value.prompts) ||
    value.prompts.length > 8 ||
    value.prompts.some(
      (p) => typeof p.prompt !== 'string' || p.prompt.length > 1024 || typeof p.echo !== 'boolean',
    )
  )
    throw new Error('Invalid server prompts.');
  if (
    value.trust &&
    (typeof value.trust.address !== 'string' ||
      value.trust.address.length > 253 ||
      !Number.isInteger(value.trust.port) ||
      value.trust.port < 1 ||
      value.trust.port > 65535 ||
      !validFingerprint(value.trust.fingerprint) ||
      (value.trust.previous !== undefined && !validFingerprint(value.trust.previous)))
  )
    throw new Error('Invalid host identity.');
  return {
    ...(value.trust ? { trust: { ...value.trust } } : {}),
    title: value.title,
    instructions: value.instructions,
    prompts: value.prompts.map((p) => ({ prompt: p.prompt, echo: p.echo })),
  };
}
