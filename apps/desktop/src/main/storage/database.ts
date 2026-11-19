import {
  validateWorkspaceTemplate,
  MAX_WORKSPACE_TEMPLATES,
  type WorkspaceTemplate,
} from '../../shared/workspace-templates.ts';
import { validFingerprint } from '../../shared/ssh.ts';
import {
  validateHost,
  validHostId,
  validateGroup,
  validateGroupPath,
  resolveHost,
  validateIdentity,
  jumpChain,
  type HostGroup,
  type SavedHost,
  type SshIdentity,
} from '../../shared/hosts.ts';
import { AppFailure } from '../failures.ts';
import { unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, rename, rm, stat, open, link } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { validateWorkspaceBackup, type WorkspaceBackup } from '../../shared/backup.ts';
import {
  MAX_FORWARD_RULES,
  validatePortForward,
  type PortForwardRule,
} from '../../shared/port-forwarding.ts';
import { MAX_PROXIES, validateProxy, type SavedProxy } from '../../shared/proxies.ts';

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
  (connection: DatabaseSync) => {
    connection.exec(`CREATE TABLE known_hosts (
      address TEXT NOT NULL, port INTEGER NOT NULL CHECK(port BETWEEN 1 AND 65535),
      fingerprint TEXT NOT NULL, PRIMARY KEY(address, port)
    ) STRICT;`);
  },
  (connection: DatabaseSync) => {
    connection.exec(`
      CREATE TABLE ssh_identities (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL,
        method TEXT NOT NULL CHECK(method IN ('password','privateKey','keyboard-interactive'))
      ) STRICT;
      ALTER TABLE hosts ADD COLUMN identityId TEXT REFERENCES ssh_identities(id) ON DELETE SET NULL;
      ALTER TABLE host_groups ADD COLUMN identityId TEXT REFERENCES ssh_identities(id) ON DELETE SET NULL;
    `);
  },
  (connection: DatabaseSync) => {
    connection.exec(`CREATE TABLE transfer_recovery (
      id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(length(data) <= 65536)
    ) STRICT;`);
  },
  (connection: DatabaseSync) => {
    connection.exec(`CREATE TABLE workspace_templates (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      data TEXT NOT NULL CHECK(length(data) <= 65536)
    ) STRICT;`);
  },
  (connection: DatabaseSync) => {
    connection.exec(`
      ALTER TABLE hosts ADD COLUMN environment TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE host_groups ADD COLUMN environment TEXT NOT NULL DEFAULT '[]';
    `);
  },
  (connection: DatabaseSync) => {
    connection.exec(`CREATE TABLE port_forwards (
      id TEXT PRIMARY KEY, hostId TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      data TEXT NOT NULL CHECK(length(data) <= 4096)
    ) STRICT;`);
  },
  (connection: DatabaseSync) => {
    // No foreign key: deleteHost clears references, and the column stays droppable.
    connection.exec('ALTER TABLE hosts ADD COLUMN jumpHostId TEXT;');
  },
  (connection: DatabaseSync) => {
    // Hosts reference proxies without a foreign key; deleteProxy clears references.
    connection.exec(`
      CREATE TABLE proxies (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(length(data) <= 2048)) STRICT;
      ALTER TABLE hosts ADD COLUMN proxyId TEXT;
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
  if (pragmaNumber(database, 'user_version') >= 4)
    database.prepare('SELECT address, port, fingerprint FROM known_hosts LIMIT 0').all();
  if (pragmaNumber(database, 'user_version') >= 5) {
    database.prepare('SELECT id, name, username, method FROM ssh_identities LIMIT 0').all();
    database.prepare('SELECT identityId FROM hosts LIMIT 0').all();
    database.prepare('SELECT identityId FROM host_groups LIMIT 0').all();
  }
  if (pragmaNumber(database, 'user_version') >= 6)
    database.prepare('SELECT id,data FROM transfer_recovery LIMIT 0').all();
  if (pragmaNumber(database, 'user_version') >= 7)
    database.prepare('SELECT id,name,data FROM workspace_templates LIMIT 0').all();
  if (pragmaNumber(database, 'user_version') >= 8) {
    database.prepare('SELECT environment FROM hosts LIMIT 0').all();
    database.prepare('SELECT environment FROM host_groups LIMIT 0').all();
  }
  if (pragmaNumber(database, 'user_version') >= 9)
    database.prepare('SELECT id,hostId,data FROM port_forwards LIMIT 0').all();
  if (pragmaNumber(database, 'user_version') >= 10)
    database.prepare('SELECT jumpHostId FROM hosts LIMIT 0').all();
  if (pragmaNumber(database, 'user_version') >= 11) {
    database.prepare('SELECT id,data FROM proxies LIMIT 0').all();
    database.prepare('SELECT proxyId FROM hosts LIMIT 0').all();
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

export function knownHostAddress(address: string, port: number): string {
  const host = validateHost({ name: 'Identity', address, port, username: '', protocol: 'ssh' });
  return host.address.replace(/^\[(.*)\]$/, '$1').toLowerCase();
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

  listWorkspaceTemplates(): WorkspaceTemplate[] {
    const rows = this.connection
      .prepare(
        'SELECT id,name,data FROM workspace_templates ORDER BY name COLLATE NOCASE,id LIMIT 51',
      )
      .all();
    if (rows.length > MAX_WORKSPACE_TEMPLATES) throw new Error('Too many saved templates.');
    return rows.map((row) => {
      if (!validHostId(row.id) || typeof row.data !== 'string' || row.data.length > 65536)
        throw new Error('Invalid saved template.');
      const draft = validateWorkspaceTemplate(JSON.parse(row.data));
      if (row.name !== draft.name) throw new Error('Invalid saved template name.');
      return { ...draft, id: row.id };
    });
  }
  saveWorkspaceTemplate(value: unknown): WorkspaceTemplate {
    const draft = validateWorkspaceTemplate(value);
    const templates = this.listWorkspaceTemplates();
    if (
      templates.length >= MAX_WORKSPACE_TEMPLATES ||
      templates.some((item) => item.name.toLowerCase() === draft.name.toLowerCase())
    )
      throw new Error('Choose a unique template name.');
    const hosts = new Set(this.listHosts().map((host) => host.id));
    if (draft.panes.some((pane) => pane.hostId && !hosts.has(pane.hostId)))
      throw new Error('A template host no longer exists.');
    const id = randomUUID();
    this.connection
      .prepare('INSERT INTO workspace_templates (id,name,data) VALUES (?,?,?)')
      .run(id, draft.name, JSON.stringify(draft));
    return { ...draft, id };
  }
  deleteWorkspaceTemplate(id: unknown): void {
    if (!validHostId(id)) throw new Error('Invalid template ID.');
    this.connection.prepare('DELETE FROM workspace_templates WHERE id=?').run(id);
  }

  listProxies(): SavedProxy[] {
    const rows = this.connection
      .prepare('SELECT id,data FROM proxies ORDER BY rowid LIMIT 51')
      .all();
    if (rows.length > MAX_PROXIES) throw new Error('Too many saved proxies.');
    return rows.map((row) => {
      if (!validHostId(row.id) || typeof row.data !== 'string' || row.data.length > 2048)
        throw new Error('Invalid saved proxy.');
      return { ...validateProxy(JSON.parse(row.data)), id: row.id };
    });
  }
  saveProxy(value: unknown, id?: unknown): SavedProxy {
    if (id !== undefined && !validHostId(id)) throw new Error('Invalid proxy ID.');
    const draft = validateProxy(value);
    const key = (id as string | undefined) ?? randomUUID();
    this.transaction((db) => {
      if (id !== undefined) {
        const result = db
          .prepare('UPDATE proxies SET data=? WHERE id=?')
          .run(JSON.stringify(draft), key);
        if (result.changes !== 1) throw new Error('Proxy no longer exists.');
      } else {
        const count = Number(db.prepare('SELECT count(*) AS n FROM proxies').get()?.n);
        if (count >= MAX_PROXIES) throw new Error('Too many saved proxies.');
        db.prepare('INSERT INTO proxies (id,data) VALUES (?,?)').run(key, JSON.stringify(draft));
      }
    });
    return { ...draft, id: key };
  }
  deleteProxy(id: unknown): void {
    if (!validHostId(id)) throw new Error('Invalid proxy ID.');
    this.transaction((db) => {
      // Hosts that used this proxy connect directly afterwards.
      db.prepare('UPDATE hosts SET proxyId=NULL WHERE proxyId=?').run(id);
      db.prepare('DELETE FROM proxies WHERE id=?').run(id);
    });
  }

  listPortForwards(hostId: unknown): PortForwardRule[] {
    if (!validHostId(hostId)) throw new Error('Invalid host ID.');
    const rows = this.connection
      .prepare('SELECT id,hostId,data FROM port_forwards WHERE hostId=? ORDER BY rowid LIMIT 21')
      .all(hostId);
    if (rows.length > MAX_FORWARD_RULES) throw new Error('Too many saved forwards.');
    return rows.map((row) => {
      if (!validHostId(row.id) || typeof row.data !== 'string' || row.data.length > 4096)
        throw new Error('Invalid saved forward.');
      return { ...validatePortForward(JSON.parse(row.data)), id: row.id, hostId };
    });
  }
  savePortForward(hostId: unknown, value: unknown, id?: unknown): PortForwardRule {
    if (!validHostId(hostId) || (id !== undefined && !validHostId(id)))
      throw new Error('Invalid forward ID.');
    const draft = validatePortForward(value);
    const key = (id as string | undefined) ?? randomUUID();
    this.transaction((db) => {
      if (!db.prepare('SELECT id FROM hosts WHERE id=?').get(hostId))
        throw new Error('Host no longer exists.');
      if (id !== undefined) {
        const result = db
          .prepare('UPDATE port_forwards SET data=? WHERE id=? AND hostId=?')
          .run(JSON.stringify(draft), key, hostId);
        if (result.changes !== 1) throw new Error('Forward no longer exists.');
      } else {
        const count = Number(
          db.prepare('SELECT count(*) AS n FROM port_forwards WHERE hostId=?').get(hostId)?.n,
        );
        if (count >= MAX_FORWARD_RULES) throw new Error('Too many saved forwards.');
        db.prepare('INSERT INTO port_forwards (id,hostId,data) VALUES (?,?,?)').run(
          key,
          hostId,
          JSON.stringify(draft),
        );
      }
    });
    return { ...draft, id: key, hostId };
  }
  deletePortForward(id: unknown): void {
    if (!validHostId(id)) throw new Error('Invalid forward ID.');
    this.connection.prepare('DELETE FROM port_forwards WHERE id=?').run(id);
  }
  portForward(id: string): PortForwardRule | undefined {
    const row = this.connection.prepare('SELECT hostId FROM port_forwards WHERE id=?').get(id);
    return row ? this.listPortForwards(row.hostId).find((rule) => rule.id === id) : undefined;
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
            environment: JSON.parse(String(row.environment)),
            inheritPort: row.inheritPort === 1,
            inheritUsername: row.inheritUsername === 1,
            identityId: row.identityId ?? null,
            jumpHostId: row.jumpHostId ?? null,
            proxyId: row.proxyId ?? null,
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
      if (
        host.identityId &&
        !db.prepare('SELECT id FROM ssh_identities WHERE id=?').get(host.identityId)
      )
        throw new Error('Identity no longer exists.');
      resolveHost(host, this.listHostGroups());
      if (host.jumpHostId) {
        const others = this.listHosts().filter((item) => item.id !== key);
        jumpChain({ id: key, jumpHostId: host.jumpHostId }, others);
      }
      if (host.proxyId && !db.prepare('SELECT id FROM proxies WHERE id=?').get(host.proxyId))
        throw new Error('Proxy no longer exists.');
      if (id) {
        const result = db
          .prepare(
            'UPDATE hosts SET name=?, address=?, port=?, username=?, protocol=?, groupPath=?, tags=?, inheritPort=?, inheritUsername=?, identityId=?, environment=?, jumpHostId=?, proxyId=? WHERE id=?',
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
            host.identityId ?? null,
            JSON.stringify(host.environment ?? []),
            host.jumpHostId ?? null,
            host.proxyId ?? null,
            key,
          );
        if (result.changes !== 1) throw new Error('Host no longer exists.');
      } else {
        db.prepare(
          'INSERT INTO hosts (id,name,address,port,username,protocol,groupPath,tags,inheritPort,inheritUsername,identityId,environment,jumpHostId,proxyId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
          host.identityId ?? null,
          JSON.stringify(host.environment ?? []),
          host.jumpHostId ?? null,
          host.proxyId ?? null,
        );
      }
    });
    return { ...host, id: key };
  }

  deleteHost(id: unknown): void {
    if (!validHostId(id)) throw new Error('Invalid host ID.');
    this.transaction((db) => {
      // Hosts that jumped through this one connect directly afterwards.
      db.prepare('UPDATE hosts SET jumpHostId=NULL WHERE jumpHostId=?').run(id);
      db.prepare('DELETE FROM hosts WHERE id=?').run(id);
    });
  }

  listHostGroups(): HostGroup[] {
    return this.connection
      .prepare('SELECT * FROM host_groups ORDER BY path COLLATE NOCASE')
      .all()
      .map((row) => validateGroup({ ...row, environment: JSON.parse(String(row.environment)) }));
  }

  saveHostGroup(value: unknown): void {
    const group = validateGroup(value);
    this.transaction((db) => {
      const parent = group.path.includes('/')
        ? group.path.slice(0, group.path.lastIndexOf('/'))
        : '';
      if (parent && !db.prepare('SELECT path FROM host_groups WHERE path=?').get(parent))
        throw new Error('Parent group missing.');
      if (
        group.identityId &&
        !db.prepare('SELECT id FROM ssh_identities WHERE id=?').get(group.identityId)
      )
        throw new Error('Identity no longer exists.');
      db.prepare(
        'INSERT INTO host_groups (path,port,username,identityId,environment) VALUES (?, ?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET port=excluded.port, username=excluded.username, identityId=excluded.identityId, environment=excluded.environment',
      ).run(
        group.path,
        group.port,
        group.username,
        group.identityId ?? null,
        JSON.stringify(group.environment ?? []),
      );
      // A group edit must not make an existing host's merged environment invalid.
      const groups = this.listHostGroups();
      for (const item of groups.filter(
        (item) => item.path === group.path || item.path.startsWith(group.path + '/'),
      ))
        resolveHost(
          {
            name: 'Group',
            address: 'localhost',
            port: 22,
            username: '',
            protocol: 'ssh',
            groupPath: item.path,
          },
          groups,
        );
      for (const host of this.listHosts().filter(
        (host) => host.groupPath === group.path || host.groupPath?.startsWith(group.path + '/'),
      ))
        resolveHost(host, groups);
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
            "UPDATE hosts SET groupPath='', port=?, username=?, inheritPort=0, inheritUsername=0, identityId=?, environment=? WHERE id=?",
          ).run(
            effective.port,
            effective.username,
            effective.identityId ?? null,
            JSON.stringify(effective.environment ?? []),
            host.id,
          );
        }
      }
      for (const group of descendants)
        db.prepare('DELETE FROM host_groups WHERE path=?').run(group.path);
    });
  }

  listSshIdentities(): SshIdentity[] {
    return this.connection
      .prepare('SELECT id,name,username,method FROM ssh_identities ORDER BY name COLLATE NOCASE,id')
      .all()
      .map((row) => {
        if (!validHostId(row.id)) throw new AppFailure('database-invalid');
        return { id: row.id, ...validateIdentity(row) };
      });
  }

  saveSshIdentity(value: unknown, id?: string): SshIdentity {
    const identity = validateIdentity(value);
    if (id !== undefined && !validHostId(id)) throw new Error('Invalid identity ID.');
    const key = id ?? randomUUID();
    if (id) {
      const result = this.connection
        .prepare('UPDATE ssh_identities SET name=?,username=?,method=? WHERE id=?')
        .run(identity.name, identity.username, identity.method, key);
      if (result.changes !== 1) throw new Error('Identity no longer exists.');
    } else {
      this.connection
        .prepare('INSERT INTO ssh_identities (id,name,username,method) VALUES (?,?,?,?)')
        .run(key, identity.name, identity.username, identity.method);
    }
    return { id: key, ...identity };
  }

  deleteSshIdentity(value: unknown): void {
    if (!validHostId(value)) throw new Error('Invalid identity ID.');
    this.connection.prepare('DELETE FROM ssh_identities WHERE id=?').run(value);
  }

  getKnownHost(address: string, port: number): string | undefined {
    const endpoint = knownHostAddress(address, port);
    const row = this.connection
      .prepare('SELECT fingerprint FROM known_hosts WHERE address=? AND port=?')
      .get(endpoint, port);
    if (!row) return undefined;
    if (!validFingerprint(row.fingerprint)) throw new AppFailure('database-invalid');
    return row.fingerprint;
  }

  trustKnownHost(address: string, port: number, fingerprint: string, previous?: string): void {
    const endpoint = knownHostAddress(address, port);
    if (!validFingerprint(fingerprint) || (previous !== undefined && !validFingerprint(previous)))
      throw new Error('Invalid fingerprint.');
    this.transaction((db) => {
      const current = this.getKnownHost(endpoint, port);
      if (current === fingerprint) return;
      if (current !== previous) throw new AppFailure('ssh-key-mismatch');
      db.prepare(
        'INSERT INTO known_hosts VALUES (?, ?, ?) ON CONFLICT(address,port) DO UPDATE SET fingerprint=excluded.fingerprint',
      ).run(endpoint, port, fingerprint);
    });
  }

  get workspaceId(): string {
    return String(this.connection.prepare('SELECT id FROM workspaces').get()?.id);
  }

  exportWorkspace(): WorkspaceBackup {
    return validateWorkspaceBackup({
      format: 'mterminal-workspace',
      version: 1,
      exportedAt: new Date().toISOString(),
      hosts: this.listHosts(),
      groups: this.listHostGroups(),
      identities: this.listSshIdentities(),
      knownHosts: this.connection
        .prepare('SELECT address,port,fingerprint FROM known_hosts ORDER BY address,port')
        .all(),
    });
  }

  importWorkspace(value: unknown): number {
    const data = validateWorkspaceBackup(value);
    const count =
      data.hosts.length + data.groups.length + data.identities.length + data.knownHosts.length;
    this.transaction((db) => {
      for (const identity of data.identities)
        if (db.prepare('SELECT id FROM ssh_identities WHERE id=?').get(identity.id))
          throw new Error('Backup conflicts with an existing identity. No records were imported.');
      for (const group of data.groups)
        if (db.prepare('SELECT path FROM host_groups WHERE path=?').get(group.path))
          throw new Error('Backup conflicts with an existing group. No records were imported.');
      for (const host of data.hosts)
        if (db.prepare('SELECT id FROM hosts WHERE id=?').get(host.id))
          throw new Error('Backup conflicts with an existing host. No records were imported.');
      for (const known of data.knownHosts) {
        const current = db
          .prepare('SELECT fingerprint FROM known_hosts WHERE address=? AND port=?')
          .get(known.address, known.port);
        if (current && current.fingerprint !== known.fingerprint)
          throw new Error('Backup conflicts with a trusted host key. No records were imported.');
      }
      for (const identity of data.identities)
        db.prepare('INSERT INTO ssh_identities (id,name,username,method) VALUES (?,?,?,?)').run(
          identity.id,
          identity.name,
          identity.username,
          identity.method,
        );
      for (const group of [...data.groups].sort(
        (a, b) => a.path.split('/').length - b.path.split('/').length,
      ))
        db.prepare(
          'INSERT INTO host_groups (path,port,username,identityId,environment) VALUES (?,?,?,?,?)',
        ).run(
          group.path,
          group.port,
          group.username,
          group.identityId ?? null,
          JSON.stringify(group.environment ?? []),
        );
      for (const host of data.hosts)
        db.prepare(
          'INSERT INTO hosts (id,name,address,port,username,protocol,groupPath,tags,inheritPort,inheritUsername,identityId,environment) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        ).run(
          host.id,
          host.name,
          host.address,
          host.port,
          host.username,
          host.protocol,
          host.groupPath ?? '',
          JSON.stringify(host.tags ?? []),
          Number(host.inheritPort),
          Number(host.inheritUsername),
          host.identityId ?? null,
          JSON.stringify(host.environment ?? []),
        );
      // Jump references may point at hosts inserted later in the same import.
      for (const host of data.hosts)
        if (host.jumpHostId)
          db.prepare('UPDATE hosts SET jumpHostId=? WHERE id=?').run(host.jumpHostId, host.id);
      for (const host of data.hosts)
        if (host.proxyId && db.prepare('SELECT id FROM proxies WHERE id=?').get(host.proxyId))
          db.prepare('UPDATE hosts SET proxyId=? WHERE id=?').run(host.proxyId, host.id);
      const merged = this.listHosts();
      for (const host of data.hosts) jumpChain(host, merged);
      for (const known of data.knownHosts)
        db.prepare(
          'INSERT OR IGNORE INTO known_hosts (address,port,fingerprint) VALUES (?,?,?)',
        ).run(known.address, known.port, known.fingerprint);
    });
    return count;
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
