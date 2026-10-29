import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scrypt } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, rm, chmod, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { utils } from '../ssh2-module.js';
import { validHostId } from '../../shared/hosts.js';
import { AppFailure } from '../failures.js';
import { formatSshPublicKey } from '../../shared/ssh.js';
import type { CommandHistoryEntry } from '../../shared/history.js';

export interface SafeStorageProvider {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(value: string): Promise<Buffer>;
  decryptStringAsync(value: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>;
  getSelectedStorageBackend(): string;
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
            /^[0-9a-f-]{36}\.(password|key)\.enc$/.test(name),
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
    for (const name of files.filter((item) => /^[0-9a-f-]{36}\.(password|key)\.enc$/.test(item))) {
      const path = join(this.directory, name);
      const info = await lstat(path);
      const isKey = name.endsWith('.key.enc');
      if (!info.isFile() || info.size < 1 || info.size > (isKey ? 512 * 1024 : 16 * 1024))
        throw new AppFailure('vault-corrupt');
      const decrypted = await this.storage.decryptStringAsync(await readFile(path));
      if (decrypted.result.startsWith(SshSecretStore.payloadPrefix)) {
        await this.reveal(decrypted.result, true);
        if (decrypted.shouldReEncrypt)
          await this.writeEncrypted(path, await this.storage.encryptStringAsync(decrypted.result));
        continue;
      }
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

  private async readHistory(): Promise<CommandHistoryEntry[]> {
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
        (entry: CommandHistoryEntry) => entry.lastUsed > Date.now() - 30 * 86400000,
      );
      if (recent.length !== entries.length) await this.writeHistory(recent);
      return recent;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  private async writeHistory(entries: CommandHistoryEntry[]): Promise<void> {
    while (entries.length > 500 || Buffer.byteLength(JSON.stringify(entries)) > 512 * 1024)
      entries.pop();
    await this.writeEncrypted(
      join(this.directory, 'history.enc'),
      await this.storage.encryptStringAsync(await this.protect(JSON.stringify(entries))),
    );
  }

  recordCommand(command: string, directory: string): Promise<void> {
    // Filters are a convenience; command recording is opt-in because secrets cannot be detected reliably.
    if (
      !command.trim() ||
      command.startsWith(' ') ||
      command.length > 4096 ||
      directory.length > 4096 ||
      Array.from(command).some((character) => {
        const code = character.charCodeAt(0);
        return (code < 32 && code !== 10 && code !== 13) || code === 127;
      }) ||
      /(?:password|passwd|token|secret|api[_-]?key)\s*(?:=|\s)|https?:\/\/[^\s/]+:[^\s/]+@/i.test(
        command,
      )
    )
      return Promise.resolve();
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

  searchHistory(prefix: string, directory: string): Promise<CommandHistoryEntry[]> {
    return this.serialize(async () =>
      (await this.readHistory())
        .filter((entry) => entry.command.startsWith(prefix))
        .sort(
          (a, b) =>
            Number(b.directory === directory) - Number(a.directory === directory) ||
            b.lastUsed - a.lastUsed ||
            b.uses - a.uses,
        )
        .slice(0, 20),
    );
  }

  deleteHistory(id?: string): Promise<void> {
    return this.serialize(async () => {
      const entries = await this.readHistory();
      await this.writeHistory(id ? entries.filter((entry) => entry.id !== id) : []);
    });
  }

  private async requireSecureStorage(): Promise<void> {
    if (
      (this.platform === 'linux' &&
        !['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(
          this.storage.getSelectedStorageBackend(),
        )) ||
      !(await this.storage.isAsyncEncryptionAvailable())
    )
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

  private async writeEncrypted(path: string, encrypted: Buffer): Promise<void> {
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
      await rename(temporary, path);
      await chmod(path, 0o600);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async passwordStatus(identityId: string): Promise<{ available: boolean; saved: boolean }> {
    this.requireUnlocked();
    const path = this.path(identityId);
    try {
      await this.requireSecureStorage();
    } catch {
      return { available: false, saved: false };
    }
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.size < 1 || info.size > 16 * 1024)
        throw new AppFailure('vault-corrupt');
      return { available: true, saved: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { available: true, saved: false };
      throw error;
    }
  }

  savePassword(identityId: string, password: string): Promise<void> {
    const path = this.path(identityId);
    if (typeof password !== 'string' || password.length < 1 || password.length > 4096)
      return Promise.reject(new Error('Invalid password.'));
    return this.serialize(async () => {
      this.requireUnlocked();
      await this.requireSecureStorage();
      const encrypted = await this.storage.encryptStringAsync(await this.protect(password));
      if (!Buffer.isBuffer(encrypted) || encrypted.length < 1 || encrypted.length > 16 * 1024)
        throw new AppFailure('vault-unavailable');
      await this.writeEncrypted(path, encrypted);
    });
  }

  getPassword(identityId: string): Promise<string | undefined> {
    return this.serialize(async () => {
      const path = this.path(identityId);
      this.requireUnlocked();
      await this.requireSecureStorage();
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
        return password;
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

  savePrivateKey(identityId: string, privateKey: string, passphrase = ''): Promise<void> {
    const path = this.keyPath(identityId);
    if (
      typeof privateKey !== 'string' ||
      privateKey.length < 1 ||
      privateKey.length > 256 * 1024 ||
      typeof passphrase !== 'string' ||
      passphrase.length > 4096
    )
      return Promise.reject(new Error('Private key is too large or invalid.'));
    const parsed = utils.parseKey(privateKey, passphrase);
    if (parsed instanceof Error || Array.isArray(parsed) || !parsed.isPrivateKey())
      return Promise.reject(new Error('Invalid private key or passphrase.'));
    return this.serialize(async () => {
      this.requireUnlocked();
      await this.requireSecureStorage();
      const encrypted = await this.storage.encryptStringAsync(
        await this.protect(JSON.stringify({ privateKey, passphrase })),
      );
      if (!Buffer.isBuffer(encrypted) || encrypted.length < 1 || encrypted.length > 512 * 1024)
        throw new AppFailure('vault-unavailable');
      await this.writeEncrypted(path, encrypted);
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
