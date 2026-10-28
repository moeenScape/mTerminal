import { unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, rename, rm, stat, open, link } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';

const APPLICATION_ID = 0x4d544552;
const migrations = [
  (connection: DatabaseSync) => {
    connection.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT;
      CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;
    `);
    connection
      .prepare('INSERT INTO workspaces VALUES (?, ?, ?)')
      .run(randomUUID(), 'Local workspace', new Date().toISOString());
  },
];
const SCHEMA_VERSION = migrations.length;

async function acquireLock(path: string): Promise<() => void> {
  const lock = await open(path + '.lock', 'wx', 0o600);
  try {
    await lock.writeFile(String(process.pid));
  } catch (error) {
    await lock.close();
    await rm(path + '.lock', { force: true });
    throw error;
  }
  await lock.close();
  return () => unlinkSync(path + '.lock');
}

function pragmaNumber(database: DatabaseSync, name: string): number {
  return Number(Object.values(database.prepare(`PRAGMA ${name}`).get() ?? {})[0]);
}

function checkIntegrity(database: DatabaseSync): void {
  const rows = database.prepare('PRAGMA quick_check').all();
  if (rows.length !== 1 || Object.values(rows[0] ?? {})[0] !== 'ok') {
    throw new Error('Database integrity check failed. Preserve the file for recovery.');
  }
}

function validateDatabase(database: DatabaseSync): void {
  checkIntegrity(database);
  if (
    pragmaNumber(database, 'application_id') !== APPLICATION_ID ||
    pragmaNumber(database, 'user_version') < 1 ||
    pragmaNumber(database, 'user_version') > SCHEMA_VERSION
  ) {
    throw new Error('The database belongs to another application or schema version.');
  }
  const versions = database.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
  if (
    versions.length !== pragmaNumber(database, 'user_version') ||
    versions.some((row, index) => row.version !== index + 1)
  ) {
    throw new Error('Invalid migration history.');
  }
  const workspace = database.prepare('SELECT id, name FROM workspaces').all();
  if (
    workspace.length !== 1 ||
    typeof workspace[0]?.id !== 'string' ||
    !/^[0-9a-f-]{36}$/.test(workspace[0].id) ||
    workspace[0].name !== 'Local workspace'
  ) {
    throw new Error('Invalid local workspace.');
  }
}

export class LocalDatabase {
  private readonly connection: DatabaseSync;
  readonly path: string;
  private readonly releaseLock: () => void;
  private constructor(connection: DatabaseSync, path: string, releaseLock: () => void) {
    this.connection = connection;
    this.path = path;
    this.releaseLock = releaseLock;
  }

  static async open(path: string): Promise<LocalDatabase> {
    await mkdir(dirname(path), { recursive: true });
    const release = await acquireLock(path);
    let connection: DatabaseSync;
    try {
      connection = new DatabaseSync(path);
    } catch (error) {
      release();
      throw error;
    }
    const store = new LocalDatabase(connection, path, release);
    try {
      await chmod(path, 0o600);
      connection.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
      checkIntegrity(connection);
      const version = pragmaNumber(connection, 'user_version');
      const application = pragmaNumber(connection, 'application_id');
      if (
        version < 0 ||
        version > SCHEMA_VERSION ||
        (version > 0 && application !== APPLICATION_ID) ||
        (application !== 0 && application !== APPLICATION_ID)
      ) {
        throw new Error(
          'Unsupported database. Preserve it and use the matching application version.',
        );
      }
      if (version === 0) {
        const objects = connection
          .prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")
          .all();
        if (application !== 0 || objects.length)
          throw new Error('Unrecognized database; refusing to modify it.');
      } else {
        validateDatabase(connection);
        if (version < SCHEMA_VERSION) await store.createBackup(join(dirname(path), 'backups'));
      }
      for (let index = version; index < migrations.length; index++) {
        store.transaction(() => {
          migrations[index]!(connection);
          connection
            .prepare('INSERT INTO schema_migrations VALUES (?, ?)')
            .run(index + 1, new Date().toISOString());
          connection.exec(
            `PRAGMA application_id = ${APPLICATION_ID}; PRAGMA user_version = ${index + 1};`,
          );
        });
      }
      validateDatabase(connection);
      const snapshots = join(dirname(path), 'backups');
      const initialName = `schema-${SCHEMA_VERSION}-initial.sqlite`;
      try {
        await stat(join(snapshots, initialName));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        await store.createBackup(snapshots, initialName);
      }
      return store;
    } catch (error) {
      connection.close();
      release();
      throw error;
    }
  }

  transaction<T>(operation: (database: DatabaseSync) => T): T {
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      const result = operation(this.connection);
      if (result && typeof (result as { then?: unknown }).then === 'function') {
        throw new Error('Database transactions must be synchronous.');
      }
      this.connection.exec('COMMIT');
      return result;
    } catch (error) {
      this.connection.exec('ROLLBACK');
      throw error;
    }
  }

  get workspaceId(): string {
    return String(this.connection.prepare('SELECT id FROM workspaces').get()?.id);
  }

  async createBackup(
    directory: string,
    name = `${Date.now()}-${randomUUID()}.sqlite`,
  ): Promise<string> {
    if (name !== name.split(/[\\/]/).pop()) throw new Error('Invalid backup filename.');
    await mkdir(directory, { recursive: true });
    const destination = join(directory, name);
    const staged = destination + `.partial-${randomUUID()}`;
    try {
      await backup(this.connection, staged);
      await chmod(staged, 0o600);
      const snapshot = new DatabaseSync(staged, { readOnly: true });
      try {
        validateDatabase(snapshot);
      } finally {
        snapshot.close();
      }
      // Publish the complete file atomically without replacing an existing backup.
      await link(staged, destination);
      return destination;
    } finally {
      await rm(staged, { force: true });
    }
  }

  close(): void {
    try {
      this.connection.close();
    } finally {
      this.releaseLock();
    }
  }
}

/** Offline operation: all connections to destination must be closed by the caller. */
export async function recoverDatabase(snapshot: string, destination: string): Promise<void> {
  if (resolve(snapshot) === resolve(destination)) throw new Error('Choose a separate backup file.');
  const release = await acquireLock(destination);
  try {
    // Refuse databases with journals: recovery must never discard uncheckpointed writes.
    for (const suffix of ['-wal', '-shm', '-journal']) {
      try {
        await stat(destination + suffix);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      throw new Error('Database journal exists. Close the application cleanly before recovery.');
    }
    const source = new DatabaseSync(snapshot, { readOnly: true });
    const staged = destination + `.recovery-${randomUUID()}`;
    try {
      validateDatabase(source);
      await backup(source, staged);
      await chmod(staged, 0o600);
      const check = new DatabaseSync(staged, { readOnly: true });
      try {
        validateDatabase(check);
      } finally {
        check.close();
      }
      // Preserve the original before installing the validated snapshot.
      const { copyFile, constants } = await import('node:fs/promises');
      try {
        await copyFile(
          destination,
          destination + `.before-recovery-${randomUUID()}`,
          constants.COPYFILE_EXCL,
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await rename(staged, destination);
    } finally {
      source.close();
      await rm(staged, { force: true });
    }
  } finally {
    release();
  }
}
