import {
  validateHost,
  validHostId,
  validateGroup,
  validateGroupPath,
  resolveHost,
  type HostGroup,
  type SavedHost,
} from '../../shared/hosts.ts';
import { AppFailure } from '../failures.ts';
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
  (connection: DatabaseSync) => {
    connection.exec(`CREATE TABLE hosts (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, address TEXT NOT NULL,
      port INTEGER NOT NULL CHECK(port BETWEEN 1 AND 65535), username TEXT NOT NULL,
      protocol TEXT NOT NULL CHECK(protocol = 'ssh')
    ) STRICT;`);
  },
  (connection: DatabaseSync) => {
    connection.exec(`
      CREATE TABLE host_groups (path TEXT PRIMARY KEY, port INTEGER CHECK(port BETWEEN 1 AND 65535), username TEXT) STRICT;
      ALTER TABLE hosts ADD COLUMN groupPath TEXT NOT NULL DEFAULT '';
      ALTER TABLE hosts ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE hosts ADD COLUMN inheritPort INTEGER NOT NULL DEFAULT 0 CHECK(inheritPort IN (0,1));
      ALTER TABLE hosts ADD COLUMN inheritUsername INTEGER NOT NULL DEFAULT 0 CHECK(inheritUsername IN (0,1));
    `);
  },
];
const SCHEMA_VERSION = migrations.length;

async function acquireLock(path: string): Promise<() => void> {
  let lock;
  try {
    lock = await open(path + '.lock', 'wx', 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new AppFailure('database-locked');
    throw error;
  }
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
    throw new AppFailure('database-invalid');
  }
}

function validateDatabase(database: DatabaseSync): void {
  checkIntegrity(database);
  if (
    pragmaNumber(database, 'application_id') !== APPLICATION_ID ||
    pragmaNumber(database, 'user_version') < 1 ||
    pragmaNumber(database, 'user_version') > SCHEMA_VERSION
  ) {
    throw new AppFailure('database-invalid');
  }
  const versions = database.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
  if (
    versions.length !== pragmaNumber(database, 'user_version') ||
    versions.some((row, index) => row.version !== index + 1)
  ) {
    throw new AppFailure('database-invalid');
  }
  if (pragmaNumber(database, 'user_version') >= 2)
    database.prepare('SELECT id, name, address, port, username, protocol FROM hosts LIMIT 0').all();
  if (pragmaNumber(database, 'user_version') >= 3) {
    database.prepare('SELECT path, port, username FROM host_groups LIMIT 0').all();
    database
      .prepare('SELECT groupPath, tags, inheritPort, inheritUsername FROM hosts LIMIT 0')
      .all();
  }
  const workspace = database.prepare('SELECT id, name FROM workspaces').all();
  if (
    workspace.length !== 1 ||
    typeof workspace[0]?.id !== 'string' ||
    !/^[0-9a-f-]{36}$/.test(workspace[0].id) ||
    workspace[0].name !== 'Local workspace'
  ) {
    throw new AppFailure('database-invalid');
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
        throw new AppFailure('database-invalid');
      }
      if (version === 0) {
        const objects = connection
          .prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")
          .all();
        if (application !== 0 || objects.length) throw new AppFailure('database-invalid');
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

  listHosts(): SavedHost[] {
    return this.connection
      .prepare('SELECT * FROM hosts ORDER BY name COLLATE NOCASE, id')
      .all()
      .map((row) => {
        if (!validHostId(row.id)) throw new Error('Invalid saved host.');
        return {
          ...validateHost({
            ...row,
            tags: JSON.parse(String(row.tags)),
            inheritPort: row.inheritPort === 1,
            inheritUsername: row.inheritUsername === 1,
          }),
          id: row.id,
        };
      });
  }

  saveHost(value: unknown, id?: string): SavedHost {
    const host = validateHost(value);
    if (id !== undefined && !validHostId(id)) throw new Error('Invalid host ID.');
    const key = id ?? randomUUID();
    this.transaction((db) => {
      if (
        host.groupPath &&
        !db.prepare('SELECT path FROM host_groups WHERE path=?').get(host.groupPath)
      )
        throw new Error('Group no longer exists.');
      if (id) {
        const result = db
          .prepare(
            'UPDATE hosts SET name=?, address=?, port=?, username=?, protocol=?, groupPath=?, tags=?, inheritPort=?, inheritUsername=? WHERE id=?',
          )
          .run(
            host.name,
            host.address,
            host.port,
            host.username,
            host.protocol,
            host.groupPath!,
            JSON.stringify(host.tags),
            Number(host.inheritPort),
            Number(host.inheritUsername),
            key,
          );
        if (result.changes !== 1) throw new Error('Host no longer exists.');
      } else {
        db.prepare(
          'INSERT INTO hosts (id,name,address,port,username,protocol,groupPath,tags,inheritPort,inheritUsername) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(
          key,
          host.name,
          host.address,
          host.port,
          host.username,
          host.protocol,
          host.groupPath!,
          JSON.stringify(host.tags),
          Number(host.inheritPort),
          Number(host.inheritUsername),
        );
      }
    });
    return { ...host, id: key };
  }

  deleteHost(id: unknown): void {
    if (!validHostId(id)) throw new Error('Invalid host ID.');
    this.connection.prepare('DELETE FROM hosts WHERE id=?').run(id);
  }

  listHostGroups(): HostGroup[] {
    return this.connection
      .prepare('SELECT * FROM host_groups ORDER BY path COLLATE NOCASE')
      .all()
      .map(validateGroup);
  }

  saveHostGroup(value: unknown): void {
    const group = validateGroup(value);
    this.transaction((db) => {
      const parent = group.path.includes('/')
        ? group.path.slice(0, group.path.lastIndexOf('/'))
        : '';
      if (parent && !db.prepare('SELECT path FROM host_groups WHERE path=?').get(parent))
        throw new Error('Parent group missing.');
      db.prepare(
        'INSERT INTO host_groups VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET port=excluded.port, username=excluded.username',
      ).run(group.path, group.port, group.username);
    });
  }

  deleteHostGroup(value: unknown): void {
    const path = validateGroupPath(value);
    this.transaction((db) => {
      const groups = this.listHostGroups();
      const hosts = this.listHosts();
      const descendants = groups.filter((g) => g.path === path || g.path.startsWith(path + '/'));
      for (const group of descendants) {
        // Preserve effective connection values when removing inherited defaults.
        for (const host of hosts.filter((h) => h.groupPath === group.path)) {
          const effective = resolveHost(host, groups);
          db.prepare(
            "UPDATE hosts SET groupPath='', port=?, username=?, inheritPort=0, inheritUsername=0 WHERE id=?",
          ).run(effective.port, effective.username, host.id);
        }
      }
      for (const group of descendants)
        db.prepare('DELETE FROM host_groups WHERE path=?').run(group.path);
    });
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
