import { createHash, randomUUID } from 'node:crypto';
import { open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { SyncPreferences } from '../../shared/sync-preferences.js';
import { WorkspaceSyncFailure } from '../../shared/workspace-sync.js';

export class SyncPreferenceStore {
  readonly path: string;

  constructor(directory: string, origin: string, accountId: string) {
    const context = createHash('sha256')
      .update(JSON.stringify([origin, accountId]))
      .digest('hex');
    this.path = join(directory, `sync-preferences-${context}.json`);
  }

  async read(): Promise<SyncPreferences> {
    try {
      const file = await open(this.path, 'r');
      try {
        if ((await file.stat()).size > 256) throw new Error('Invalid preference file.');
        const value = JSON.parse(await file.readFile('utf8')) as Partial<SyncPreferences>;
        if (typeof value.metadata !== 'boolean' || typeof value.credentials !== 'boolean')
          throw new Error('Invalid preference file.');
        return { metadata: value.metadata, credentials: value.credentials };
      } finally {
        await file.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { metadata: true, credentials: false };
      throw new WorkspaceSyncFailure('sync-preferences-storage');
    }
  }

  async write(value: SyncPreferences): Promise<void> {
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, 'wx', 0o600);
      try {
        await file.writeFile(JSON.stringify(value));
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, this.path);
    } catch {
      await rm(temporary, { force: true }).catch(() => {});
      throw new WorkspaceSyncFailure('sync-preferences-storage');
    }
  }
}
