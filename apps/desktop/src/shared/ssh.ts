export interface SshCredentials {
  username: string;
  method?: 'password' | 'privateKey' | 'keyboard-interactive';
  password?: string;
  privateKey?: string;
  passphrase?: string;
  keyboardInteractive?: boolean;
  fingerprint: string;
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
    if (typeof c.password !== 'string' || c.password.length > 4096)
      throw new Error('Invalid password.');
    return { ...base, password: c.password };
  }
  if (method === 'privateKey') {
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
