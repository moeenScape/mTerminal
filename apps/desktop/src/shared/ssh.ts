export interface SshCredentials {
  username: string;
  password: string;
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
    typeof c.password !== 'string' ||
    c.password.length > 4096 ||
    typeof c.fingerprint !== 'string' ||
    !/^SHA256:[A-Za-z0-9+/]{43}$/.test(c.fingerprint)
  )
    throw new Error('Invalid SSH credentials.');
  return { username: c.username, password: c.password, fingerprint: c.fingerprint };
}
