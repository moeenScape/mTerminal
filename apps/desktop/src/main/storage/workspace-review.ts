import { createHash, randomUUID } from 'node:crypto';
import type { WorkspaceBackup } from '../../shared/backup.js';
import {
  syncMetadata,
  WorkspaceSyncFailure,
  type SyncReviewRow,
  type WorkspaceSyncResult,
} from '../../shared/workspace-sync.js';
import { resolveReview, reviewRows, type SyncDocument } from './workspace-conflicts.js';
import {
  decodeSyncKey,
  readCloudWorkspace,
  writeCloudWorkspace,
  type SyncRequest,
} from './workspace-sync.js';
import type { LocalDatabase } from './database.js';

const REVIEW_TTL = 5 * 60_000;

function digest(value: object): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function localDigest(value: WorkspaceBackup): string {
  return digest({ ...value, exportedAt: '' });
}

function emptyCloud(local: WorkspaceBackup): SyncDocument {
  return { workspace: { ...local, hosts: [], groups: [], identities: [] }, tombstones: [] };
}

export class WorkspaceReview {
  private pending:
    | {
        id: string;
        until: number;
        accountId: string;
        local: string;
        cloud: string;
        changes: Map<string, SyncReviewRow>;
      }
    | undefined;

  constructor(
    private readonly database: Pick<LocalDatabase, 'exportWorkspace' | 'applyWorkspaceSync'>,
    private readonly request: SyncRequest,
    private readonly hasCredential: (id: string) => Promise<boolean>,
  ) {}

  clear(): void {
    this.pending = undefined;
  }

  async preview(input: unknown, accountId: string): Promise<WorkspaceSyncResult> {
    this.clear();
    const key = decodeSyncKey(input);
    try {
      const { snapshot, document } = await readCloudWorkspace(key, this.request, accountId);
      const current = this.database.exportWorkspace();
      const local = syncMetadata(current);
      const records = reviewRows(local, document ?? emptyCloud(local));
      const id = randomUUID();
      this.pending = {
        id,
        until: Date.now() + REVIEW_TTL,
        accountId,
        local: localDigest(current),
        cloud: digest(snapshot),
        changes: new Map(records.map((item) => [item.key, item])),
      };
      return { kind: 'review', reviewId: id, revision: snapshot.revision, records };
    } finally {
      key.fill(0);
    }
  }

  async apply(action: Record<string, unknown>, accountId: string): Promise<WorkspaceSyncResult> {
    const pending = this.pending;
    if (
      !pending ||
      pending.id !== action.reviewId ||
      pending.accountId !== accountId ||
      pending.until <= Date.now()
    )
      throw new WorkspaceSyncFailure('sync-review-stale');
    const { target, records } = action;
    if (
      (target !== 'local' && target !== 'cloud') ||
      !Array.isArray(records) ||
      !records.length ||
      records.length > pending.changes.size
    )
      throw new WorkspaceSyncFailure('invalid-input');
    const selected = new Set<string>();
    for (const item of records as unknown[]) {
      if (typeof item !== 'string' || selected.has(item))
        throw new WorkspaceSyncFailure('invalid-input');
      const change = pending.changes.get(item);
      if (!change || (target === 'local' && !change.cloud && !change.cloudDeleted))
        throw new WorkspaceSyncFailure('invalid-input');
      selected.add(item);
    }
    const key = decodeSyncKey(action.key);
    this.clear();
    try {
      if (target === 'local') {
        for (const item of selected) {
          const id = item.startsWith('host:')
            ? item.slice(5)
            : item.startsWith('identity:')
              ? item.slice(9)
              : undefined;
          if (id && pending.changes.get(item)?.cloudDeleted && (await this.hasCredential(id)))
            throw new WorkspaceSyncFailure('sync-local-protected');
        }
      }
      const { snapshot, document } = await readCloudWorkspace(key, this.request, accountId);
      const current = this.database.exportWorkspace();
      if (
        pending.until <= Date.now() ||
        pending.local !== localDigest(current) ||
        pending.cloud !== digest(snapshot)
      )
        throw new WorkspaceSyncFailure('sync-review-stale');
      const local = syncMetadata(current);
      const next = resolveReview(local, document ?? emptyCloud(local), target, [...selected]);
      let revision = snapshot.revision;
      if (target === 'local') this.database.applyWorkspaceSync(next.workspace, selected);
      else {
        if (snapshot.maxEnvelopeVersion !== 2) throw new WorkspaceSyncFailure('sync-version');
        try {
          revision = await writeCloudWorkspace(snapshot, next, key, this.request, 2);
        } catch (error) {
          if (error instanceof WorkspaceSyncFailure && error.code === 'sync-conflict')
            throw new WorkspaceSyncFailure('sync-review-stale');
          throw error;
        }
      }
      return { kind: 'review-applied', target, revision, count: selected.size };
    } finally {
      key.fill(0);
    }
  }
}
