export const proxyChannels = {
  list: 'proxies:list',
  save: 'proxies:save',
  delete: 'proxies:delete',
} as const;

export const MAX_PROXIES = 50;

export type ProxyType = 'socks5' | 'socks4' | 'http';
export const proxyTypeLabels: Record<ProxyType, string> = {
  socks5: 'SOCKS5',
  socks4: 'SOCKS4',
  http: 'HTTP CONNECT',
};

export interface ProxyDraft {
  name: string;
  type: ProxyType;
  address: string;
  port: number;
  /** Optional proxy login; the password is kept in the vault, never in this record. */
  username: string;
}
export interface SavedProxy extends ProxyDraft {
  id: string;
}
/** Listing entry; tells the UI whether a password is saved without revealing it. */
export interface ProxySummary extends SavedProxy {
  passwordSaved: boolean;
}

export interface ProxiesApi {
  listProxies: () => Promise<ProxySummary[]>;
  /**
   * `password`: a string saves it (vault must be unlocked), null removes it, undefined keeps
   * the current one.
   */
  saveProxy: (draft: ProxyDraft, password?: string | null, id?: string) => Promise<SavedProxy>;
  deleteProxy: (id: string) => Promise<void>;
}

const control = (value: string) =>
  Array.from(value).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);

export function validateProxy(value: unknown): ProxyDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid proxy.');
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some((key) => !['name', 'type', 'address', 'port', 'username'].includes(key)))
    throw new Error('Invalid proxy.');
  if (v.type !== 'socks5' && v.type !== 'socks4' && v.type !== 'http')
    throw new Error('Choose a proxy type.');
  const address = typeof v.address === 'string' ? v.address.trim().replace(/^\[(.*)\]$/, '$1') : '';
  if (
    !address ||
    address.length > 253 ||
    address.startsWith('-') ||
    !/^[A-Za-z0-9._:%-]+$/.test(address)
  )
    throw new Error('Enter a valid proxy address.');
  if (!Number.isInteger(v.port) || Number(v.port) < 1 || Number(v.port) > 65535)
    throw new Error('Enter a proxy port (1–65535).');
  const username = typeof v.username === 'string' ? v.username.trim() : '';
  if (username.length > 255 || control(username))
    throw new Error('Use a proxy username of at most 255 characters.');
  const name = typeof v.name === 'string' && v.name.trim() ? v.name.trim() : address;
  if (name.length > 100 || control(name)) throw new Error('Use a name of at most 100 characters.');
  return { name, type: v.type, address, port: Number(v.port), username };
}

export function describeProxy(proxy: ProxyDraft): string {
  const host = proxy.address.includes(':') ? `[${proxy.address}]` : proxy.address;
  return `${proxyTypeLabels[proxy.type]} ${host}:${proxy.port}`;
}
