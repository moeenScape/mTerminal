import {
  validateGroup,
  validateHost,
  validateIdentity,
  resolveHost,
  validHostId,
  type HostGroup,
  type SavedHost,
  type SshIdentity,
} from './hosts.js';
import { validFingerprint } from './ssh.js';

export interface WorkspaceBackup {
  format: 'mterminal-workspace';
  version: 1;
  exportedAt: string;
  hosts: SavedHost[];
  groups: HostGroup[];
  identities: SshIdentity[];
  knownHosts: { address: string; port: number; fingerprint: string }[];
}

export const backupChannels = { export: 'backup:export', import: 'backup:import' } as const;
export interface BackupApi {
  exportWorkspace: () => Promise<boolean>;
  importWorkspace: () => Promise<number | undefined>;
}

export function validateWorkspaceBackup(value: unknown): WorkspaceBackup {
  if (!value || typeof value !== 'object' || JSON.stringify(value).length > 5 * 1024 * 1024)
    throw new Error('Backup file is invalid or too large.');
  const backup = value as Record<string, unknown>;
  if (
    backup.format !== 'mterminal-workspace' ||
    backup.version !== 1 ||
    typeof backup.exportedAt !== 'string' ||
    !Number.isFinite(Date.parse(backup.exportedAt)) ||
    !Array.isArray(backup.hosts) ||
    !Array.isArray(backup.groups) ||
    !Array.isArray(backup.identities) ||
    !Array.isArray(backup.knownHosts) ||
    backup.hosts.length > 10000 ||
    backup.groups.length > 1000 ||
    backup.identities.length > 1000 ||
    backup.knownHosts.length > 10000
  )
    throw new Error('Backup file is invalid or too large.');
  const identities = backup.identities.map((item) => {
    if (!item || typeof item !== 'object' || !validHostId((item as SshIdentity).id))
      throw new Error('Backup contains an invalid identity.');
    return { id: (item as SshIdentity).id, ...validateIdentity(item) };
  });
  const identityIds = new Set(identities.map(({ id }) => id));
  const groups = backup.groups.map(validateGroup);
  const groupPaths = new Set(groups.map(({ path }) => path));
  const hosts = backup.hosts.map((item) => {
    if (!item || typeof item !== 'object' || !validHostId((item as SavedHost).id))
      throw new Error('Backup contains an invalid host.');
    const id = (item as SavedHost).id;
    const host = validateHost(item);
    if (
      (host.groupPath && !groupPaths.has(host.groupPath)) ||
      (host.identityId && !identityIds.has(host.identityId))
    )
      throw new Error('Backup contains an unresolved host reference.');
    return { ...host, id };
  });
  const knownHosts = backup.knownHosts.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('Backup contains an invalid host key.');
    const { address, port, fingerprint } = item as Record<string, unknown>;
    if (
      !Number.isInteger(port) ||
      Number(port) < 1 ||
      Number(port) > 65535 ||
      !validFingerprint(fingerprint)
    )
      throw new Error('Backup contains an invalid host key.');
    const endpoint = validateHost({
      name: 'Identity',
      address,
      port: Number(port),
      username: '',
      protocol: 'ssh',
    });
    return {
      address: endpoint.address.replace(/^\[(.*)\]$/, '$1').toLowerCase(),
      port: Number(port),
      fingerprint,
    };
  });
  if (
    new Set(identities.map(({ id }) => id)).size !== identities.length ||
    new Set(groups.map(({ path }) => path)).size !== groups.length ||
    new Set(hosts.map(({ id }) => id)).size !== hosts.length ||
    new Set(knownHosts.map(({ address, port }) => `${address}:${port}`)).size !== knownHosts.length
  )
    throw new Error('Backup contains duplicate records.');
  for (const group of groups) {
    if (group.identityId && !identityIds.has(group.identityId))
      throw new Error('Backup contains an unresolved group reference.');
    const parent = group.path.includes('/') ? group.path.slice(0, group.path.lastIndexOf('/')) : '';
    if (parent && !groupPaths.has(parent)) throw new Error('Backup contains an unresolved group.');
  }
  for (const group of groups)
    resolveHost(
      {
        name: 'Group',
        address: 'localhost',
        port: 22,
        username: '',
        protocol: 'ssh',
        groupPath: group.path,
      },
      groups,
    );
  for (const host of hosts) resolveHost(host, groups);
  return {
    format: 'mterminal-workspace',
    version: 1,
    exportedAt: backup.exportedAt,
    hosts,
    groups,
    identities,
    knownHosts,
  };
}
