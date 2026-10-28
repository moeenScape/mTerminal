export const hostChannels = {
  list: 'hosts:list',
  save: 'hosts:save',
  delete: 'hosts:delete',
} as const;
export interface HostDraft {
  name: string;
  address: string;
  port: number;
  username: string;
  protocol: 'ssh';
}
export interface SavedHost extends HostDraft {
  id: string;
}
export function validHostId(id: unknown): id is string {
  return (
    typeof id === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)
  );
}
export function validateHost(value: unknown): HostDraft {
  if (!value || typeof value !== 'object') throw new Error('Invalid host.');
  const h = value as Record<string, unknown>;
  const text = (key: string, max: number, required: boolean) => {
    const v = h[key];
    if (
      typeof v !== 'string' ||
      v.length > max ||
      Array.from(v).some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ) ||
      (required && !v.trim())
    )
      throw new Error('Invalid host.');
    return v.trim();
  };
  const name = text('name', 100, true);
  const address = text('address', 253, true);
  const username = text('username', 100, false);
  if (
    /\s/.test(address) ||
    address.includes('/') ||
    address.includes('@') ||
    address.startsWith('-') ||
    /\s/.test(username) ||
    username.startsWith('-') ||
    h.protocol !== 'ssh' ||
    !Number.isInteger(h.port) ||
    Number(h.port) < 1 ||
    Number(h.port) > 65535
  )
    throw new Error('Invalid host.');
  return { name, address, username, port: Number(h.port), protocol: 'ssh' };
}
export interface HostsApi {
  listHosts: () => Promise<SavedHost[]>;
  saveHost: (host: HostDraft, id?: string) => Promise<SavedHost>;
  deleteHost: (id: string) => Promise<void>;
}
