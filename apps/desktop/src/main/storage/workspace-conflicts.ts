import type { WorkspaceBackup } from '../../shared/backup.js';
import {
  jumpChain,
  validHostId,
  validateGroupPath,
  type HostGroup,
  type SavedHost,
  type SshIdentity,
} from '../../shared/hosts.js';
import {
  syncMetadata,
  WorkspaceSyncFailure,
  type SyncReviewRow,
} from '../../shared/workspace-sync.js';

export interface SyncDocument {
  workspace: WorkspaceBackup;
  tombstones: string[];
}

type Item =
  | { type: 'Host'; value: SavedHost }
  | { type: 'Group'; value: HostGroup }
  | { type: 'Identity'; value: SshIdentity };

function records(workspace: WorkspaceBackup): Map<string, Item> {
  return new Map<string, Item>([
    ...workspace.hosts.map((value) => [`host:${value.id}`, { type: 'Host', value }] as const),
    ...workspace.groups.map((value) => [`group:${value.path}`, { type: 'Group', value }] as const),
    ...workspace.identities.map(
      (value) => [`identity:${value.id}`, { type: 'Identity', value }] as const,
    ),
  ]);
}

function validTombstone(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.startsWith('host:')) return validHostId(value.slice(5));
  if (value.startsWith('identity:')) return validHostId(value.slice(9));
  if (!value.startsWith('group:')) return false;
  try {
    validateGroupPath(value.slice(6));
    return true;
  } catch {
    return false;
  }
}

export function parseSyncDocument(value: unknown, version: 1 | 2): SyncDocument {
  if (version === 1) return { workspace: syncMetadata(value), tombstones: [] };
  if (!value || typeof value !== 'object' || Object.keys(value).length !== 2)
    throw new WorkspaceSyncFailure('sync-format');
  const { workspace: raw, tombstones } = value as Record<string, unknown>;
  const workspace = syncMetadata(raw);
  const living = records(workspace);
  if (
    !Array.isArray(tombstones) ||
    tombstones.length > 15_000 ||
    !tombstones.every((key) => validTombstone(key) && !living.has(key)) ||
    new Set(tombstones).size !== tombstones.length
  )
    throw new WorkspaceSyncFailure('sync-format');
  return { workspace, tombstones };
}

export function rejectDeletedAdditions(workspace: WorkspaceBackup, tombstones: string[]): void {
  const pending = records(workspace);
  if (tombstones.some((key) => pending.has(key)))
    throw new WorkspaceSyncFailure('sync-record-conflict');
}

export function reviewRows(local: WorkspaceBackup, cloud: SyncDocument): SyncReviewRow[] {
  const left = records(local);
  const right = records(cloud.workspace);
  const deleted = new Set(cloud.tombstones);
  const changes: SyncReviewRow[] = [];
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    const localItem = left.get(key);
    const cloudItem = right.get(key);
    const before = localItem && JSON.stringify(localItem.value, null, 2);
    const after = cloudItem && JSON.stringify(cloudItem.value, null, 2);
    if (before === after) continue;
    const item = (localItem ?? cloudItem)!;
    const name = item.type === 'Group' ? item.value.path : item.value.name;
    changes.push({
      key,
      label: `${item.type} · ${name}`,
      ...(before ? { local: before } : {}),
      ...(after ? { cloud: after } : {}),
      cloudDeleted: deleted.has(key),
    });
  }
  return changes;
}

export function resolveReview(
  local: WorkspaceBackup,
  cloud: SyncDocument,
  target: 'local' | 'cloud',
  selected: string[],
): SyncDocument {
  const left = records(local);
  const right = records(cloud.workspace);
  const deleted = new Set(cloud.tombstones);
  const destination = target === 'local' ? left : right;
  const source = target === 'local' ? right : left;
  for (const key of selected) {
    const item = source.get(key);
    if (item) {
      destination.set(key, item);
      if (target === 'cloud') deleted.delete(key);
    } else {
      if (target === 'local' && !deleted.has(key)) throw new WorkspaceSyncFailure('invalid-input');
      destination.delete(key);
      if (target === 'cloud') deleted.add(key);
    }
  }
  const draft: WorkspaceBackup = { ...local, hosts: [], groups: [], identities: [] };
  for (const { type, value } of destination.values()) {
    if (type === 'Host') draft.hosts.push(value);
    else if (type === 'Group') draft.groups.push(value);
    else draft.identities.push(value);
  }
  try {
    const workspace = syncMetadata(draft);
    for (const host of workspace.hosts) jumpChain(host, workspace.hosts);
    return { workspace, tombstones: [...deleted].sort() };
  } catch {
    throw new WorkspaceSyncFailure('sync-dependencies');
  }
}
