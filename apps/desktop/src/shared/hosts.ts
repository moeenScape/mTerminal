import { validateEnvironment, type EnvironmentVariable } from './environment.ts';
export const hostChannels = {
  list: 'hosts:list',
  save: 'hosts:save',
  delete: 'hosts:delete',
  groups: 'hosts:groups',
  saveGroup: 'hosts:save-group',
  deleteGroup: 'hosts:delete-group',
  identities: 'hosts:identities',
  saveIdentity: 'hosts:save-identity',
  deleteIdentity: 'hosts:delete-identity',
} as const;
export interface HostDraft {
  environment?: EnvironmentVariable[];
  name: string;
  address: string;
  port: number;
  username: string;
  protocol: 'ssh';
  groupPath?: string;
  tags?: string[];
  inheritPort?: boolean;
  inheritUsername?: boolean;
  identityId?: string | null;
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
  const groupPath = validateGroupPath(h.groupPath ?? '', true);
  if (h.tags !== undefined && (!Array.isArray(h.tags) || h.tags.length > 20))
    throw new Error('Invalid tags.');
  const tags = [
    ...new Set(
      ((h.tags ?? []) as unknown[]).map((tag) => {
        if (
          typeof tag !== 'string' ||
          !tag.trim() ||
          tag.length > 32 ||
          /[,/]/.test(tag) ||
          Array.from(tag).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
        )
          throw new Error('Invalid tag.');
        return tag.trim().toLowerCase();
      }),
    ),
  ].sort();
  for (const field of ['inheritPort', 'inheritUsername'])
    if (h[field] !== undefined && typeof h[field] !== 'boolean')
      throw new Error('Invalid inheritance flag.');
  const identityId = h.identityId == null || h.identityId === '' ? null : h.identityId;
  if (identityId !== null && (typeof identityId !== 'string' || !validHostId(identityId)))
    throw new Error('Invalid identity.');
  const environment = validateEnvironment(h.environment);
  const result: HostDraft = {
    ...(environment.length ? { environment } : {}),
    name,
    address,
    username,
    port: Number(h.port),
    protocol: 'ssh',
    groupPath,
    tags,
    inheritPort: h.inheritPort === true,
    inheritUsername: h.inheritUsername === true,
    identityId,
  };
  return result;
}
export interface HostsApi {
  listHostGroups: () => Promise<HostGroup[]>;
  saveHostGroup: (group: HostGroup) => Promise<void>;
  deleteHostGroup: (path: string) => Promise<void>;
  listHosts: () => Promise<SavedHost[]>;
  saveHost: (host: HostDraft, id?: string) => Promise<SavedHost>;
  deleteHost: (id: string) => Promise<void>;
  listSshIdentities: () => Promise<SshIdentity[]>;
  saveSshIdentity: (identity: SshIdentityDraft, id?: string) => Promise<SshIdentity>;
  deleteSshIdentity: (id: string) => Promise<void>;
}

export interface HostGroup {
  environment?: EnvironmentVariable[];
  path: string;
  port: number | null;
  username: string | null;
  identityId?: string | null;
}
export interface SshIdentity {
  id: string;
  name: string;
  username: string;
  method: 'password' | 'privateKey' | 'keyboard-interactive';
}
export type SshIdentityDraft = Omit<SshIdentity, 'id'>;
export function validateIdentity(value: unknown): SshIdentityDraft {
  if (!value || typeof value !== 'object') throw new Error('Invalid identity.');
  const { name, username, method } = value as Record<string, unknown>;
  if (
    typeof name !== 'string' ||
    !name.trim() ||
    name.length > 100 ||
    Array.from(name).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
    typeof username !== 'string' ||
    !username.trim() ||
    username.length > 100 ||
    /\s/.test(username) ||
    username.startsWith('-') ||
    Array.from(username).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
    !['password', 'privateKey', 'keyboard-interactive'].includes(String(method))
  )
    throw new Error('Invalid identity.');
  return { name: name.trim(), username: username.trim(), method: method as SshIdentity['method'] };
}
export function validateGroupPath(value: unknown, allowEmpty = false): string {
  if (allowEmpty && value === '') return '';
  if (
    typeof value !== 'string' ||
    value.length > 200 ||
    value.split('/').length > 8 ||
    value
      .split('/')
      .some(
        (part) =>
          !part.trim() ||
          part !== part.trim() ||
          part.length > 50 ||
          part === '.' ||
          part === '..' ||
          Array.from(part).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127),
      )
  )
    throw new Error('Invalid group path.');
  return value;
}
export function validateGroup(value: unknown): HostGroup {
  if (!value || typeof value !== 'object') throw new Error('Invalid group.');
  const g = value as HostGroup;
  const path = validateGroupPath(g.path);
  const fields = validateHost({
    name: 'Group',
    address: 'localhost',
    protocol: 'ssh',
    port: g.port === null ? 22 : g.port,
    username: g.username === null ? '' : g.username,
  });
  if (g.identityId != null && !validHostId(g.identityId)) throw new Error('Invalid identity.');
  const environment = validateEnvironment(g.environment);
  return {
    ...(environment.length ? { environment } : {}),
    path,
    port: g.port === null ? null : fields.port,
    username: g.username === null ? null : fields.username,
    identityId: g.identityId ?? null,
  };
}
export function resolveHost(host: HostDraft, groups: HostGroup[]): HostDraft {
  let port = 22;
  let username = '';
  let identityId: string | null = null;
  const environment = new Map<string, EnvironmentVariable>();
  const parts = (host.groupPath ?? '').split('/');
  for (let i = 1; i <= parts.length; i++) {
    const group = groups.find((g) => g.path === parts.slice(0, i).join('/'));
    if (group?.port != null) port = group.port;
    if (group?.username != null) username = group.username;
    if (group?.identityId) identityId = group.identityId;
    for (const entry of group?.environment ?? []) environment.set(entry.name, entry);
  }
  identityId = host.identityId ?? identityId;
  for (const entry of host.environment ?? []) environment.set(entry.name, entry);
  const values = validateEnvironment([...environment.values()]);
  return {
    ...host,
    ...(values.length ? { environment: values } : {}),
    port: host.inheritPort ? port : host.port,
    username: host.inheritUsername ? username : host.username,
    identityId,
  };
}
