import {
  MAX_SESSION_LOGS,
  LOG_RETENTION_MS,
  validateSessionLog,
  validateLogAnnotation,
  type SessionLog,
} from '../../shared/session-logs.js';
import {
  MAX_SNIPPETS,
  validateSnippet,
  validateSnippetCatalog,
  validStartupTarget,
  MAX_STARTUP_ASSIGNMENTS,
  type SnippetCatalog,
  type Snippet,
} from '../../shared/snippets.js';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scrypt } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, rm, chmod, readdir, link } from 'node:fs/promises';
import { join } from 'node:path';
import { utils } from '../ssh2-module.js';
import { validHostId } from '../../shared/hosts.js';
import { AppFailure } from '../failures.js';
import type { SshPasswordStatus } from '../../shared/vault.js';
import { validateSshCredentials, formatSshPublicKey } from '../../shared/ssh.js';
import {
  historyMatches,
  isRecordableCommand,
  type CommandHistoryEntry,
  type HistorySearchMode,
} from '../../shared/history.js';

type StoredHistoryEntry = Omit<CommandHistoryEntry, 'source'>;

export type SyncCredentialValue =
  | { kind: 'password'; password: string; username?: string }
  | { kind: 'key'; privateKey: string; passphrase: string };

async function credentialFileExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function validatePrivateKey(privateKey: string, passphrase: string): void {
  if (
    typeof privateKey !== 'string' ||
    privateKey.length < 1 ||
    privateKey.length > 256 * 1024 ||
    typeof passphrase !== 'string' ||
    passphrase.length > 4096
  )
    throw new Error('Private key is too large or invalid.');
  const parsed = utils.parseKey(privateKey, passphrase);
  if (parsed instanceof Error || Array.isArray(parsed) || !parsed.isPrivateKey())
    throw new Error('Invalid private key or passphrase.');
}

export interface SafeStorageProvider {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(value: string): Promise<Buffer>;
  decryptStringAsync(value: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>;
  getSelectedStorageBackend(): string;
}

export async function secureStorageAvailable(
  storage: SafeStorageProvider,
  platform: NodeJS.Platform,
): Promise<boolean> {
  return (
    (platform !== 'linux' ||
      ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(
        storage.getSelectedStorageBackend(),
      )) &&
    (await storage.isAsyncEncryptionAvailable())
  );
}

export class SshSecretStore {
  private writes: Promise<void> = Promise.resolve();
  private vaultMutations: Promise<void> = Promise.resolve();
  private masterKey: Buffer | undefined;
  private unlocking = false;
  private readonly masterPath: string;
  private static readonly payloadPrefix = 'mterminal-v1:';

  constructor(
    private readonly directory: string,
    private readonly storage: SafeStorageProvider,
    private readonly platform: NodeJS.Platform,
  ) {
    this.masterPath = join(directory, 'vault.master');
  }

  private get unlocked(): boolean {
    return this.masterKey !== undefined;
  }

  private requireUnlocked(initializing = false): void {
    if (!this.unlocked || (this.unlocking && !initializing)) throw new AppFailure('vault-locked');
  }

  private deriveKey(passphrase: string, salt: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      scrypt(
        passphrase,
        salt,
        32,
        { N: 1 << 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
        (error, key) => (error ? reject(error) : resolve(key)),
      );
    });
  }

  async vaultStatus(): Promise<{ configured: boolean; locked: boolean; available: boolean }> {
    let configured = false;
    try {
      const info = await lstat(this.masterPath);
      if (!info.isFile() || info.size < 1 || info.size > 4096)
        throw new AppFailure('vault-corrupt');
      configured = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    let available = true;
    try {
      await this.requireSecureStorage();
    } catch {
      available = false;
    }
    return { configured, locked: configured && (!this.unlocked || this.unlocking), available };
  }

  setupVault(passphrase: string): Promise<void> {
    return this.serializeVaultMutation(() => this.setupVaultInternal(passphrase));
  }

  private async setupVaultInternal(passphrase: string): Promise<void> {
    this.validatePassphrase(passphrase);
    await this.requireSecureStorage();
    const status = await this.vaultStatus();
    if (status.configured) throw new Error('The vault is already configured.');
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const wrappingKey = await this.deriveKey(passphrase, salt);
    const masterKey = randomBytes(32);
    try {
      const cipher = createCipheriv('aes-256-gcm', wrappingKey, iv);
      const wrappedKey = Buffer.concat([cipher.update(masterKey), cipher.final()]);
      const record = JSON.stringify({
        version: 1,
        salt: salt.toString('base64'),
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        key: wrappedKey.toString('base64'),
      });
      await this.writeEncrypted(this.masterPath, Buffer.from(record));
      this.masterKey = masterKey;
      this.unlocking = true;
      await this.migrateLegacySecrets();
    } catch (error) {
      masterKey.fill(0);
      this.masterKey = undefined;
      throw error;
    } finally {
      this.unlocking = false;
      wrappingKey.fill(0);
    }
  }

  unlockVault(passphrase: string): Promise<void> {
    return this.serializeVaultMutation(() => this.unlockVaultInternal(passphrase));
  }

  private async unlockVaultInternal(passphrase: string): Promise<void> {
    this.validatePassphrase(passphrase);
    await this.requireSecureStorage();
    if (this.unlocked) return;
    const recordBuffer = await readFile(this.masterPath);
    let record: { version?: unknown; salt?: unknown; iv?: unknown; tag?: unknown; key?: unknown };
    try {
      record = JSON.parse(recordBuffer.toString('utf8'));
    } catch {
      throw new AppFailure('vault-corrupt');
    }
    if (
      record.version !== 1 ||
      typeof record.salt !== 'string' ||
      typeof record.iv !== 'string' ||
      typeof record.tag !== 'string' ||
      typeof record.key !== 'string'
    )
      throw new AppFailure('vault-corrupt');
    const salt = Buffer.from(record.salt, 'base64');
    const iv = Buffer.from(record.iv, 'base64');
    const tag = Buffer.from(record.tag, 'base64');
    const wrappedKey = Buffer.from(record.key, 'base64');
    if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16 || wrappedKey.length !== 32)
      throw new AppFailure('vault-corrupt');
    const wrappingKey = await this.deriveKey(passphrase, salt);
    let masterKey: Buffer;
    try {
      const decipher = createDecipheriv('aes-256-gcm', wrappingKey, iv);
      decipher.setAuthTag(tag);
      masterKey = Buffer.concat([decipher.update(wrappedKey), decipher.final()]);
    } catch {
      throw new AppFailure('vault-passphrase-wrong');
    } finally {
      wrappingKey.fill(0);
    }
    this.masterKey = masterKey;
    this.unlocking = true;
    try {
      await this.migrateLegacySecrets();
    } catch (error) {
      this.masterKey.fill(0);
      this.masterKey = undefined;
      throw error;
    } finally {
      this.unlocking = false;
    }
  }

  lockVault(): Promise<void> {
    return this.serialize(async () => {
      this.masterKey?.fill(0);
      this.masterKey = undefined;
    });
  }

  resetVault(): Promise<void> {
    return this.serializeVaultMutation(() =>
      this.serialize(async () => {
        this.masterKey?.fill(0);
        this.masterKey = undefined;
        let names: string[];
        try {
          names = await readdir(this.directory);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
          throw error;
        }
        const files = names.filter(
          (name) =>
            name === 'vault.master' ||
            name === 'history.enc' ||
            name === 'snippets.enc' ||
            name === 'session-logs.enc' ||
            /^[0-9a-f-]{36}\.(password|key|login)\.enc$/.test(name),
        );
        if (!files.length) return;
        const recoveryDirectory = join(this.directory, `recovery-${Date.now()}-${randomUUID()}`);
        await mkdir(recoveryDirectory, { mode: 0o700 });
        const moved: string[] = [];
        try {
          for (const name of files) {
            const source = join(this.directory, name);
            const info = await lstat(source);
            if (!info.isFile()) throw new AppFailure('vault-corrupt');
            await rename(source, join(recoveryDirectory, name));
            moved.push(name);
          }
          await chmod(recoveryDirectory, 0o700);
        } catch (error) {
          for (const name of moved.reverse())
            await rename(join(recoveryDirectory, name), join(this.directory, name));
          await rm(recoveryDirectory, { recursive: true, force: true });
          throw error;
        }
      }),
    );
  }

  private validatePassphrase(passphrase: string): void {
    if (typeof passphrase !== 'string' || passphrase.length < 12 || passphrase.length > 256)
      throw new AppFailure('vault-passphrase-weak');
  }

  private async protect(value: string, initializing = false): Promise<string> {
    this.requireUnlocked(initializing);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.masterKey!, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return (
      SshSecretStore.payloadPrefix +
      JSON.stringify({
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        data: encrypted.toString('base64'),
      })
    );
  }

  private async reveal(value: string, initializing = false): Promise<string> {
    this.requireUnlocked(initializing);
    if (!value.startsWith(SshSecretStore.payloadPrefix)) return value;
    try {
      const envelope = JSON.parse(value.slice(SshSecretStore.payloadPrefix.length)) as {
        iv?: unknown;
        tag?: unknown;
        data?: unknown;
      };
      if (
        typeof envelope.iv !== 'string' ||
        typeof envelope.tag !== 'string' ||
        typeof envelope.data !== 'string'
      )
        throw new Error('Invalid envelope.');
      const iv = Buffer.from(envelope.iv, 'base64');
      const tag = Buffer.from(envelope.tag, 'base64');
      const data = Buffer.from(envelope.data, 'base64');
      if (iv.length !== 12 || tag.length !== 16 || data.length > 512 * 1024)
        throw new Error('Invalid envelope.');
      const decipher = createDecipheriv('aes-256-gcm', this.masterKey!, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    } catch {
      throw new AppFailure('vault-corrupt');
    }
  }

  private async migrateLegacySecrets(): Promise<void> {
    this.requireUnlocked(true);
    let files: string[];
    try {
      files = await readdir(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const name of files.filter((item) =>
      /^[0-9a-f-]{36}\.(password|key|login)\.enc$/.test(item),
    )) {
      const path = join(this.directory, name);
      const info = await lstat(path);
      const isKey = name.endsWith('.key.enc');
      const isLogin = name.endsWith('.login.enc');
      if (
        !info.isFile() ||
        info.size < 1 ||
        info.size > (isKey ? 512 * 1024 : isLogin ? 64 * 1024 : 16 * 1024)
      )
        throw new AppFailure('vault-corrupt');
      const decrypted = await this.storage.decryptStringAsync(await readFile(path));
      if (decrypted.result.startsWith(SshSecretStore.payloadPrefix)) {
        await this.reveal(decrypted.result, true);
        if (decrypted.shouldReEncrypt)
          await this.writeEncrypted(path, await this.storage.encryptStringAsync(decrypted.result));
        continue;
      }
      if (isLogin) throw new AppFailure('vault-corrupt');
      if (isKey) {
        const value = JSON.parse(decrypted.result) as {
          privateKey?: unknown;
          passphrase?: unknown;
        };
        if (typeof value.privateKey !== 'string' || typeof value.passphrase !== 'string')
          throw new AppFailure('vault-corrupt');
        const key = utils.parseKey(value.privateKey, value.passphrase);
        if (key instanceof Error || Array.isArray(key) || !key.isPrivateKey())
          throw new AppFailure('vault-corrupt');
      } else if (!decrypted.result || decrypted.result.length > 4096) {
        throw new AppFailure('vault-corrupt');
      }
      const protectedValue = await this.protect(decrypted.result, true);
      await this.writeEncrypted(path, await this.storage.encryptStringAsync(protectedValue));
    }
  }

  private async readHistory(): Promise<StoredHistoryEntry[]> {
    this.requireUnlocked();
    await this.requireSecureStorage();
    const path = join(this.directory, 'history.enc');
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.size > 2 * 1024 * 1024) throw new AppFailure('vault-corrupt');
      const decrypted = await this.storage.decryptStringAsync(await readFile(path));
      const entries: unknown = JSON.parse(await this.reveal(decrypted.result));
      if (!Array.isArray(entries) || entries.length > 500) throw new AppFailure('vault-corrupt');
      for (const entry of entries) {
        if (
          !entry ||
          !validHostId(entry.id) ||
          typeof entry.command !== 'string' ||
          entry.command.length > 4096 ||
          typeof entry.directory !== 'string' ||
          entry.directory.length > 4096 ||
          !Number.isFinite(entry.lastUsed) ||
          !Number.isSafeInteger(entry.uses) ||
          entry.uses < 1
        )
          throw new AppFailure('vault-corrupt');
      }
      const recent = entries.filter(
        (entry: StoredHistoryEntry) => entry.lastUsed > Date.now() - 30 * 86400000,
      );
      if (recent.length !== entries.length) await this.writeHistory(recent);
      return recent;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  private async writeHistory(entries: StoredHistoryEntry[]): Promise<void> {
    while (entries.length > 500 || Buffer.byteLength(JSON.stringify(entries)) > 512 * 1024)
      entries.pop();
    await this.writeEncrypted(
      join(this.directory, 'history.enc'),
      await this.storage.encryptStringAsync(await this.protect(JSON.stringify(entries))),
    );
  }

  recordCommand(command: string, directory: string): Promise<void> {
    // Filters are a convenience; secrets cannot be detected reliably.
    if (!isRecordableCommand(command) || directory.length > 4096) return Promise.resolve();
    return this.serialize(async () => {
      const entries = await this.readHistory();
      const previous = entries.find(
        (entry) => entry.command === command && entry.directory === directory,
      );
      await this.writeHistory([
        {
          id: previous?.id ?? randomUUID(),
          command,
          directory,
          lastUsed: Date.now(),
          uses: Math.min((previous?.uses ?? 0) + 1, 1000000),
        },
        ...entries.filter((entry) => entry !== previous),
      ]);
    });
  }

  /** Every saved command matching `query`, ranked: current directory, then most recent. */
  searchHistory(
    query: string,
    directory: string,
    mode: HistorySearchMode = 'prefix',
  ): Promise<CommandHistoryEntry[]> {
    return this.serialize(async () =>
      (await this.readHistory())
        .filter((entry) => historyMatches(entry.command, query, mode))
        .sort(
          (a, b) =>
            Number(b.directory === directory) - Number(a.directory === directory) ||
            b.lastUsed - a.lastUsed ||
            b.uses - a.uses,
        )
        .map((entry) => ({ ...entry, source: 'saved' as const })),
    );
  }

  deleteHistory(id?: string): Promise<void> {
    return this.serialize(async () => {
      const entries = await this.readHistory();
      await this.writeHistory(id ? entries.filter((entry) => entry.id !== id) : []);
    });
  }

  private async writeSessionLogs(logs: SessionLog[]): Promise<void> {
    if (logs.length > MAX_SESSION_LOGS) throw new Error('Session log limit reached.');
    const plaintext = JSON.stringify({ version: 1, logs });
    if (Buffer.byteLength(plaintext) > 512 * 1024) throw new Error('Session log limit reached.');
    await this.writeEncrypted(
      join(this.directory, 'session-logs.enc'),
      await this.storage.encryptStringAsync(await this.protect(plaintext)),
    );
  }
  private async readSessionLogs(): Promise<SessionLog[]> {
    this.requireUnlocked();
    await this.requireSecureStorage();
    try {
      const path = join(this.directory, 'session-logs.enc');
      const info = await lstat(path);
      if (!info.isFile() || info.size < 1 || info.size > 2 * 1024 * 1024)
        throw new AppFailure('vault-corrupt');
      const decrypted = await this.storage.decryptStringAsync(await readFile(path));
      const plaintext = await this.reveal(decrypted.result);
      if (Buffer.byteLength(plaintext) > 512 * 1024) throw new AppFailure('vault-corrupt');
      const data = JSON.parse(plaintext) as { version: number; logs: unknown[] };
      if (data.version !== 1 || !Array.isArray(data.logs) || data.logs.length > MAX_SESSION_LOGS)
        throw new AppFailure('vault-corrupt');
      const logs = Array.from(data.logs).map(validateSessionLog);
      if (new Set(logs.map((log) => log.id)).size !== logs.length)
        throw new AppFailure('vault-corrupt');
      const recent = logs.filter((log) => log.createdAt > Date.now() - LOG_RETENTION_MS);
      if (recent.length !== logs.length || decrypted.shouldReEncrypt)
        await this.writeSessionLogs(recent);
      return recent;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      if (error instanceof AppFailure) throw error;
      throw new AppFailure('vault-corrupt');
    }
  }
  listSessionLogs(): Promise<SessionLog[]> {
    return this.serialize(() => this.readSessionLogs());
  }
  saveSessionLog(value: unknown): Promise<void> {
    const log = validateSessionLog(value);
    return this.serialize(async () => {
      if (log.createdAt <= Date.now() - LOG_RETENTION_MS) throw new Error('Session log expired.');
      const logs = await this.readSessionLogs();
      if (!logs.some((item) => item.id === log.id) && logs.length >= MAX_SESSION_LOGS)
        throw new Error('Delete a saved log before recording another.');
      await this.writeSessionLogs([log, ...logs.filter((item) => item.id !== log.id)]);
    });
  }
  annotateSessionLog(id: string, value: unknown): Promise<void> {
    if (!validHostId(id)) throw new Error('Invalid log ID.');
    return this.serialize(async () => {
      const logs = await this.readSessionLogs();
      const log = logs.find((item) => item.id === id);
      if (!log) throw new Error('Session log missing.');
      Object.assign(log, validateLogAnnotation(value, log.text.length));
      await this.writeSessionLogs(logs);
    });
  }
  deleteSessionLog(id: string): Promise<void> {
    if (!validHostId(id)) throw new Error('Invalid log ID.');
    return this.serialize(async () => {
      const logs = await this.readSessionLogs();
      await this.writeSessionLogs(logs.filter((log) => log.id !== id));
    });
  }

  private async readSnippetCatalog(): Promise<SnippetCatalog> {
    this.requireUnlocked();
    await this.requireSecureStorage();
    try {
      const path = join(this.directory, 'snippets.enc');
      const info = await lstat(path);
      if (!info.isFile() || info.size < 1 || info.size > 2 * 1024 * 1024)
        throw new AppFailure('vault-corrupt');
      const decrypted = await this.storage.decryptStringAsync(await readFile(path));
      const plaintext = await this.reveal(decrypted.result);
      if (Buffer.byteLength(plaintext) > 512 * 1024) throw new AppFailure('vault-corrupt');
      const catalog = validateSnippetCatalog(JSON.parse(plaintext));
      if (decrypted.shouldReEncrypt)
        await this.writeEncrypted(path, await this.storage.encryptStringAsync(decrypted.result));
      return catalog;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { version: 1, snippets: [], startup: [] };
      if (error instanceof AppFailure) throw error;
      throw new AppFailure('vault-corrupt');
    }
  }
  private async writeSnippetCatalog(catalog: SnippetCatalog): Promise<void> {
    const plaintext = JSON.stringify(catalog);
    if (Buffer.byteLength(plaintext) > 512 * 1024) throw new AppFailure('snippet-limit');
    await this.writeEncrypted(
      join(this.directory, 'snippets.enc'),
      await this.storage.encryptStringAsync(await this.protect(plaintext)),
    );
  }
  listSnippets(): Promise<Snippet[]> {
    return this.serialize(async () => (await this.readSnippetCatalog()).snippets);
  }
  saveSnippet(value: unknown, id?: string): Promise<Snippet> {
    const draft = validateSnippet(value);
    if (id !== undefined && !validHostId(id)) throw new Error('Invalid snippet ID.');
    return this.serialize(async () => {
      const catalog = await this.readSnippetCatalog();
      const snippets = catalog.snippets;
      const existing = snippets.find((item) => item.id === id);
      if (id && !existing) throw new AppFailure('snippet-missing');
      if (!id && snippets.length >= MAX_SNIPPETS) throw new AppFailure('snippet-limit');
      if (
        snippets.some(
          (item) =>
            item.id !== id &&
            item.folder === draft.folder &&
            item.name.toLowerCase() === draft.name.toLowerCase(),
        )
      )
        throw new AppFailure('snippet-conflict');
      const saved = { ...draft, id: id ?? randomUUID() };
      await this.writeSnippetCatalog({
        ...catalog,
        snippets: existing
          ? snippets.map((item) => (item.id === id ? saved : item))
          : [...snippets, saved],
      });
      return saved;
    });
  }
  deleteSnippet(id: string): Promise<void> {
    if (!validHostId(id)) throw new Error('Invalid snippet ID.');
    return this.serialize(async () => {
      const catalog = await this.readSnippetCatalog();
      const snippets = catalog.snippets;
      await this.writeSnippetCatalog({
        ...catalog,
        snippets: snippets.filter((item) => item.id !== id),
        startup: catalog.startup.filter((item) => item.snippetId !== id),
      });
    });
  }

  getStartupSnippet(target: string): Promise<Snippet | null> {
    if (!validStartupTarget(target)) throw new Error('Invalid startup target.');
    return this.serialize(async () => {
      const catalog = await this.readSnippetCatalog();
      const assignment = catalog.startup.find((item) => item.target === target);
      return catalog.snippets.find((snippet) => snippet.id === assignment?.snippetId) ?? null;
    });
  }
  setStartupSnippet(target: string, snippetId: string | null): Promise<void> {
    if (!validStartupTarget(target) || (snippetId !== null && !validHostId(snippetId)))
      throw new Error('Invalid startup assignment.');
    return this.serialize(async () => {
      const catalog = await this.readSnippetCatalog();
      if (snippetId && !catalog.snippets.some((snippet) => snippet.id === snippetId))
        throw new AppFailure('snippet-missing');
      const startup = catalog.startup.filter((item) => item.target !== target);
      if (snippetId) startup.push({ target, snippetId });
      if (startup.length > MAX_STARTUP_ASSIGNMENTS) throw new AppFailure('startup-limit');
      await this.writeSnippetCatalog({ ...catalog, startup });
    });
  }

  private async requireSecureStorage(): Promise<void> {
    if (!(await secureStorageAvailable(this.storage, this.platform)))
      throw new AppFailure('vault-unavailable');
  }

  private path(identityId: string): string {
    if (!validHostId(identityId)) throw new Error('Invalid identity ID.');
    return join(this.directory, `${identityId}.password.enc`);
  }

  private keyPath(identityId: string): string {
    if (!validHostId(identityId)) throw new Error('Invalid identity ID.');
    return join(this.directory, `${identityId}.key.enc`);
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writes.then(operation);
    this.writes = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  private serializeVaultMutation(operation: () => Promise<void>): Promise<void> {
    const result = this.vaultMutations.then(operation);
    this.vaultMutations = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  private async writeEncrypted(
    path: string,
    encrypted: Buffer,
    createOnly?: () => void,
  ): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    const temporary = join(this.directory, `.secret-${randomUUID()}.tmp`);
    try {
      const file = await open(temporary, 'wx', 0o600);
      try {
        await file.writeFile(encrypted);
        await file.sync();
      } finally {
        await file.close();
      }
      if (createOnly) {
        createOnly();
        await link(temporary, path);
      } else {
        await rename(temporary, path);
        await chmod(path, 0o600);
      }
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async passwordStatus(identityId: string): Promise<SshPasswordStatus> {
    this.requireUnlocked();
    try {
      await this.requireSecureStorage();
    } catch {
      return { available: false, saved: false };
    }
    const login = await this.getLogin(identityId);
    return {
      available: true,
      saved: !!login,
      ...(login?.username ? { username: login.username } : {}),
    };
  }

  async hasStoredCredential(id: string): Promise<boolean> {
    for (const path of [this.loginPath(id), this.path(id), this.keyPath(id)]) {
      if (await credentialFileExists(path)) return true;
    }
    return false;
  }

  private loginPath(id: string): string {
    this.path(id);
    return join(this.directory, `${id}.login.enc`);
  }
  private async readPairedLogin(
    id: string,
  ): Promise<{ username: string; password: string } | undefined> {
    const path = this.loginPath(id);
    let encrypted: Buffer;
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.size < 1 || info.size > 64 * 1024)
        throw new AppFailure('vault-corrupt');
      encrypted = await readFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
    try {
      const decrypted = await this.storage.decryptStringAsync(encrypted);
      const value = JSON.parse(await this.reveal(decrypted.result)) as Record<string, unknown>;
      if (
        !value ||
        value.version !== 1 ||
        Object.keys(value).length !== 3 ||
        typeof value.password !== 'string' ||
        !value.password
      )
        throw new AppFailure('vault-corrupt');
      const login = validateSshCredentials({
        username: value.username,
        password: value.password,
        fingerprint: '',
      });
      if (decrypted.shouldReEncrypt)
        await this.writeEncrypted(path, await this.storage.encryptStringAsync(decrypted.result));
      return { username: login.username, password: login.password! };
    } catch (error) {
      if (error instanceof AppFailure) throw error;
      throw new AppFailure('vault-corrupt');
    }
  }
  private async writeLogin(
    id: string,
    username: string,
    password: string,
    createOnly?: () => void,
  ): Promise<void> {
    const encrypted = await this.storage.encryptStringAsync(
      await this.protect(JSON.stringify({ version: 1, username, password })),
    );
    if (!Buffer.isBuffer(encrypted) || encrypted.length < 1 || encrypted.length > 64 * 1024)
      throw new AppFailure('vault-unavailable');
    await this.writeEncrypted(this.loginPath(id), encrypted, createOnly);
  }

  private async writePassword(
    path: string,
    password: string,
    createOnly?: () => void,
  ): Promise<void> {
    const encrypted = await this.storage.encryptStringAsync(await this.protect(password));
    if (!Buffer.isBuffer(encrypted) || encrypted.length < 1 || encrypted.length > 16 * 1024)
      throw new AppFailure('vault-unavailable');
    await this.writeEncrypted(path, encrypted, createOnly);
  }
  saveLogin(id: string, username: string, password: string): Promise<void> {
    this.loginPath(id);
    validateSshCredentials({ username, password, fingerprint: '' });
    if (!password) throw new Error('A saved login requires a password.');
    return this.serialize(async () => {
      this.requireUnlocked();
      await this.requireSecureStorage();
      await this.writeLogin(id, username, password);
    });
  }

  savePassword(identityId: string, password: string): Promise<void> {
    const path = this.path(identityId);
    if (typeof password !== 'string' || password.length < 1 || password.length > 4096)
      return Promise.reject(new Error('Invalid password.'));
    return this.serialize(async () => {
      this.requireUnlocked();
      await this.requireSecureStorage();
      const login = await this.readPairedLogin(identityId);
      if (login) {
        await this.writeLogin(identityId, login.username, password);
        return;
      }
      await this.writePassword(path, password);
    });
  }

  async getPassword(identityId: string): Promise<string | undefined> {
    return (await this.getLogin(identityId))?.password;
  }
  getLogin(identityId: string): Promise<{ username?: string; password: string } | undefined> {
    return this.serialize(async () => {
      const path = this.path(identityId);
      this.requireUnlocked();
      await this.requireSecureStorage();
      const paired = await this.readPairedLogin(identityId);
      if (paired) return paired;
      let encrypted: Buffer;
      try {
        const info = await lstat(path);
        if (!info.isFile() || info.size < 1 || info.size > 16 * 1024)
          throw new AppFailure('vault-corrupt');
        encrypted = await readFile(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
      try {
        const decrypted = await this.storage.decryptStringAsync(encrypted);
        const password = await this.reveal(decrypted.result);
        if (!password || password.length > 4096) throw new AppFailure('vault-corrupt');
        if (decrypted.shouldReEncrypt) {
          const rotated = await this.storage.encryptStringAsync(decrypted.result);
          await this.writeEncrypted(path, rotated);
        }
        return { password };
      } catch (error) {
        if (error instanceof AppFailure) throw error;
        throw new AppFailure('vault-unavailable');
      }
    });
  }

  deletePassword(identityId: string): Promise<void> {
    const path = this.path(identityId);
    return this.serialize(async () => {
      await rm(path, { force: true });
      await rm(this.loginPath(identityId), { force: true });
    });
  }

  async privateKeyStatus(identityId: string): Promise<{
    available: boolean;
    saved: boolean;
    publicKey?: string;
  }> {
    this.requireUnlocked();
    const path = this.keyPath(identityId);
    try {
      await this.requireSecureStorage();
    } catch {
      return { available: false, saved: false };
    }
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.size < 1 || info.size > 512 * 1024)
        throw new AppFailure('vault-corrupt');
      const key = await this.getPrivateKey(identityId);
      if (!key) return { available: true, saved: false };
      const parsed = utils.parseKey(key.privateKey, key.passphrase);
      if (parsed instanceof Error || Array.isArray(parsed)) throw new AppFailure('vault-corrupt');
      return {
        available: true,
        saved: true,
        publicKey: formatSshPublicKey(parsed.type, parsed.getPublicSSH(), parsed.comment),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { available: true, saved: false };
      throw error;
    }
  }

  async savePrivateKey(identityId: string, privateKey: string, passphrase = ''): Promise<void> {
    const path = this.keyPath(identityId);
    validatePrivateKey(privateKey, passphrase);
    return this.serialize(async () => {
      this.requireUnlocked();
      await this.requireSecureStorage();
      await this.writePrivateKey(path, privateKey, passphrase);
    });
  }

  private async writePrivateKey(
    path: string,
    privateKey: string,
    passphrase: string,
    createOnly?: () => void,
  ): Promise<void> {
    const encrypted = await this.storage.encryptStringAsync(
      await this.protect(JSON.stringify({ privateKey, passphrase })),
    );
    if (!Buffer.isBuffer(encrypted) || encrypted.length < 1 || encrypted.length > 512 * 1024)
      throw new AppFailure('vault-unavailable');
    await this.writeEncrypted(path, encrypted, createOnly);
  }

  restoreSyncedCredential(
    id: string,
    value: SyncCredentialValue,
    verifyOwner: () => void,
  ): Promise<boolean> {
    return this.serialize(async () => {
      this.requireUnlocked();
      await this.requireSecureStorage();
      try {
        if (value.kind === 'key') {
          const path = this.keyPath(id);
          if (await credentialFileExists(path)) return false;
          validatePrivateKey(value.privateKey, value.passphrase);
          await this.writePrivateKey(path, value.privateKey, value.passphrase, verifyOwner);
        } else {
          const path = this.path(id);
          if (
            (await credentialFileExists(path)) ||
            (await credentialFileExists(this.loginPath(id)))
          )
            return false;
          if (!value.password || value.password.length > 4096) throw new Error('Invalid password.');
          if (value.username !== undefined) {
            validateSshCredentials({
              username: value.username,
              password: value.password,
              fingerprint: '',
            });
            await this.writeLogin(id, value.username, value.password, verifyOwner);
          } else await this.writePassword(path, value.password, verifyOwner);
        }
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
        throw error;
      }
    });
  }

  async generatePrivateKey(identityId: string, passphrase = ''): Promise<string> {
    this.requireUnlocked();
    let privateKey: string;
    if (passphrase) {
      privateKey = await new Promise<string>((resolve, reject) => {
        utils.generateKeyPair(
          'rsa',
          { bits: 2048, passphrase, cipher: 'aes256-cbc', rounds: 16 },
          (error, pair) => (error ? reject(error) : resolve(pair.private)),
        );
      });
    } else {
      privateKey = utils.generateKeyPairSync('ed25519').private;
    }
    await this.savePrivateKey(identityId, privateKey, passphrase);
    const parsed = utils.parseKey(privateKey, passphrase);
    if (parsed instanceof Error || Array.isArray(parsed)) throw new AppFailure('vault-corrupt');
    return formatSshPublicKey(parsed.type, parsed.getPublicSSH(), parsed.comment);
  }

  getPrivateKey(
    identityId: string,
  ): Promise<{ privateKey: string; passphrase: string } | undefined> {
    const path = this.keyPath(identityId);
    return this.serialize(async () => {
      this.requireUnlocked();
      await this.requireSecureStorage();
      let encrypted: Buffer;
      try {
        const info = await lstat(path);
        if (!info.isFile() || info.size < 1 || info.size > 512 * 1024)
          throw new AppFailure('vault-corrupt');
        encrypted = await readFile(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
      try {
        const decrypted = await this.storage.decryptStringAsync(encrypted);
        const plaintext = await this.reveal(decrypted.result);
        const value = JSON.parse(plaintext) as {
          privateKey?: unknown;
          passphrase?: unknown;
        };
        if (
          typeof value.privateKey !== 'string' ||
          value.privateKey.length > 256 * 1024 ||
          typeof value.passphrase !== 'string' ||
          value.passphrase.length > 4096
        )
          throw new AppFailure('vault-corrupt');
        const parsed = utils.parseKey(value.privateKey, value.passphrase);
        if (parsed instanceof Error || Array.isArray(parsed) || !parsed.isPrivateKey())
          throw new AppFailure('vault-corrupt');
        if (decrypted.shouldReEncrypt) {
          const rotated = await this.storage.encryptStringAsync(await this.protect(plaintext));
          await this.writeEncrypted(path, rotated);
        }
        return { privateKey: value.privateKey, passphrase: value.passphrase };
      } catch (error) {
        if (error instanceof AppFailure) throw error;
        throw new AppFailure('vault-unavailable');
      }
    });
  }

  deletePrivateKey(identityId: string): Promise<void> {
    const path = this.keyPath(identityId);
    return this.serialize(async () => {
      await rm(path, { force: true });
    });
  }
}
