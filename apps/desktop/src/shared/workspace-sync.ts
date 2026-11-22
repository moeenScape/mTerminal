import type { AccountErrorCode } from '../../../../packages/shared/accounts.ts';
export { accountErrors } from '../../../../packages/shared/accounts.ts';
import { validateWorkspaceBackup, type WorkspaceBackup } from './backup.js';

export const SYNC_WORKSPACE_REQUEST = 'workspace-sync:request';
export const SYNC_QUEUE_CHANGED = 'workspace-sync:queue-changed';

export type WorkspaceSyncAction =
  | { kind: 'generate-key' | 'queue-status' | 'discard-publication' }
  | { kind: 'publish' | 'merge' | 'retry-publication'; key: string };

export type SyncQueueState =
  { status: 'idle' | 'needs-key' | 'retrying' } | { status: 'blocked'; code: AccountErrorCode };

export type WorkspaceSyncResult =
  | { kind: 'generated'; key: string }
  | { kind: 'queue-status'; queue: SyncQueueState }
  | { kind: 'published' | 'merged'; revision: number; count: number };

export type WorkspaceSyncReply =
  { ok: true; result: WorkspaceSyncResult } | { ok: false; code: AccountErrorCode };

export interface WorkspaceSyncApi {
  syncWorkspace: (action: WorkspaceSyncAction) => Promise<WorkspaceSyncResult>;
  onWorkspaceSyncQueueChanged: (listener: () => void) => () => void;
}

export class WorkspaceSyncFailure extends Error {
  constructor(readonly code: AccountErrorCode) {
    super(code);
  }
}

export function syncMetadata(value: unknown): WorkspaceBackup {
  let data: WorkspaceBackup;
  try {
    data = validateWorkspaceBackup(value);
  } catch {
    throw new WorkspaceSyncFailure('sync-format');
  }
  return {
    format: 'mterminal-workspace',
    version: 1,
    exportedAt: data.exportedAt,
    hosts: data.hosts.map((host) => ({
      id: host.id,
      name: host.name,
      address: host.address,
      port: host.port,
      username: host.username,
      protocol: host.protocol,
      groupPath: host.groupPath ?? '',
      tags: host.tags ?? [],
      inheritPort: host.inheritPort === true,
      inheritUsername: host.inheritUsername === true,
      identityId: host.identityId ?? null,
      jumpHostId: host.jumpHostId ?? null,
    })),
    groups: data.groups.map((group) => ({
      path: group.path,
      port: group.port,
      username: group.username,
      identityId: group.identityId ?? null,
    })),
    identities: data.identities,
    knownHosts: [],
  };
}

function newEntries<T>(existing: T[], incoming: T[], key: (entry: T) => string): T[] {
  const saved = new Map(existing.map((entry) => [key(entry), entry]));
  return incoming.filter((entry) => {
    const prior = saved.get(key(entry));
    if (prior === undefined) return true;
    if (JSON.stringify(prior) !== JSON.stringify(entry))
      throw new WorkspaceSyncFailure('sync-record-conflict');
    return false;
  });
}

export function syncAdditions(
  existing: WorkspaceBackup,
  incoming: WorkspaceBackup,
): WorkspaceBackup {
  return {
    ...incoming,
    hosts: newEntries(existing.hosts, incoming.hosts, (host) => host.id),
    groups: newEntries(existing.groups, incoming.groups, (group) => group.path),
    identities: newEntries(existing.identities, incoming.identities, (identity) => identity.id),
    knownHosts: [],
  };
}
