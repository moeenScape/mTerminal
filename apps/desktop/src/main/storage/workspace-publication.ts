import { createHash, randomUUID } from 'node:crypto';
import { open, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  parseSyncEnvelope,
  SYNC_HTTP_LIMIT,
} from '../../../../../packages/shared/workspace-sync.ts';
import type { WorkspaceBackup } from '../../shared/backup.js';
import {
  syncMetadata,
  WorkspaceSyncFailure,
  type WorkspaceSyncResult,
} from '../../shared/workspace-sync.js';
import type { AccountErrorCode } from '../../../../../packages/shared/accounts.ts';
import { decodeSyncKey, decryptWorkspace, encryptWorkspace } from './workspace-sync.js';

function combine<T>(queued: T[], current: T[], key: (item: T) => string): T[] {
  return [...new Map([...queued, ...current].map((item) => [key(item), item])).values()];
}

export class WorkspacePublication {
  private readonly context: string;
  readonly path: string;

  constructor(directory: string, origin: string, accountId: string) {
    this.context = JSON.stringify(['mterminal-workspace-publication', origin, accountId]);
    const name = createHash('sha256').update(this.context).digest('hex');
    this.path = join(directory, `workspace-publication-${name}.enc`);
  }

  private async read() {
    try {
      const file = await open(this.path, 'r');
      try {
        if ((await file.stat()).size > SYNC_HTTP_LIMIT)
          throw new Error('Publication is too large.');
        const envelope = parseSyncEnvelope(JSON.parse(await file.readFile('utf8')));
        if (!envelope) throw new Error('Invalid publication.');
        return envelope;
      } finally {
        await file.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new WorkspaceSyncFailure('sync-queue-storage');
    }
  }

  async pending(): Promise<boolean> {
    try {
      await stat(this.path);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw new WorkspaceSyncFailure('sync-queue-storage');
    }
  }

  async snapshot(key: Buffer): Promise<WorkspaceBackup | undefined> {
    const envelope = await this.read();
    return envelope ? decryptWorkspace(envelope, key, this.context, 0) : undefined;
  }

  async enqueue(value: WorkspaceBackup, key: Buffer): Promise<void> {
    const current = syncMetadata(value);
    const previous = await this.snapshot(key);
    if (!previous && !current.hosts.length && !current.groups.length && !current.identities.length)
      throw new WorkspaceSyncFailure('sync-empty');
    const data = previous
      ? {
          ...current,
          hosts: combine(previous.hosts, current.hosts, (host) => host.id),
          groups: combine(previous.groups, current.groups, (group) => group.path),
          identities: combine(previous.identities, current.identities, (identity) => identity.id),
        }
      : current;
    const ciphertext = JSON.stringify(encryptWorkspace(data, key, this.context, 0));
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, 'wx', 0o600);
      try {
        await file.writeFile(ciphertext);
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, this.path);
    } catch {
      await rm(temporary, { force: true }).catch(() => {});
      throw new WorkspaceSyncFailure('sync-queue-storage');
    }
  }

  async remove(): Promise<void> {
    try {
      await rm(this.path, { force: true });
    } catch {
      throw new WorkspaceSyncFailure('sync-queue-storage');
    }
  }
}

export class WorkspacePublicationRunner {
  private key: Buffer | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private blocked: AccountErrorCode | undefined;
  private disposed = false;
  private generation = 0;

  constructor(
    private readonly storage: WorkspacePublication,
    private readonly publish: (data: WorkspaceBackup, key: Buffer) => Promise<WorkspaceSyncResult>,
    private readonly serialize: (run: () => Promise<void>) => Promise<void>,
    private readonly changed: () => void,
  ) {}

  async status(): Promise<WorkspaceSyncResult> {
    if (!(await this.storage.pending())) return { kind: 'queue-status', queue: { status: 'idle' } };
    return {
      kind: 'queue-status',
      queue: this.blocked
        ? { status: 'blocked', code: this.blocked }
        : { status: this.key ? 'retrying' : 'needs-key' },
    };
  }

  async discard(): Promise<WorkspaceSyncResult> {
    await this.storage.remove();
    this.pause();
    this.blocked = undefined;
    this.changed();
    return { kind: 'queue-status', queue: { status: 'idle' } };
  }

  async start(input: unknown, data?: WorkspaceBackup): Promise<WorkspaceSyncResult> {
    const key = decodeSyncKey(input);
    try {
      if (data) await this.storage.enqueue(data, key);
      else if (!(await this.storage.snapshot(key)))
        throw new WorkspaceSyncFailure('sync-queue-empty');
      if (this.disposed) return this.status();
      this.pause();
      this.key = Buffer.from(key);
      this.blocked = undefined;
      return await this.flush();
    } finally {
      key.fill(0);
    }
  }

  private pause(): void {
    this.generation++;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.key?.fill(0);
    this.key = undefined;
  }

  dispose(): void {
    this.disposed = true;
    this.pause();
  }

  suspend(): void {
    this.pause();
    this.changed();
  }

  private async flush(): Promise<WorkspaceSyncResult> {
    if (this.disposed || !this.key) return this.status();
    const key = Buffer.from(this.key);
    try {
      const data = await this.storage.snapshot(key);
      if (!data) {
        this.pause();
        return this.status();
      }
      if (this.disposed) return this.status();
      const result = await this.publish(data, key);
      await this.storage.remove();
      this.pause();
      this.blocked = undefined;
      return result;
    } catch (error) {
      const code = error instanceof WorkspaceSyncFailure ? error.code : 'unavailable';
      if (!this.disposed && (code === 'unavailable' || code === 'rate-limited')) this.schedule();
      else {
        this.pause();
        this.blocked = code;
      }
      return this.status();
    } finally {
      key.fill(0);
      this.changed();
    }
  }

  private schedule(): void {
    if (this.disposed || !this.key || this.timer) return;
    const generation = this.generation;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.serialize(async () => {
        if (this.generation === generation) await this.flush();
      }).catch(() => {
        if (this.generation === generation) this.schedule();
      });
    }, 30_000);
    this.timer.unref();
  }
}
