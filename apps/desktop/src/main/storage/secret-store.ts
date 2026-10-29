import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, rm, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { validHostId } from '../../shared/hosts.js';
import { AppFailure } from '../failures.js';

export interface SafeStorageProvider {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(value: string): Promise<Buffer>;
  decryptStringAsync(value: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>;
  getSelectedStorageBackend(): string;
}

export class SshSecretStore {
  private writes: Promise<void> = Promise.resolve();

  constructor(
    private readonly directory: string,
    private readonly storage: SafeStorageProvider,
    private readonly platform: NodeJS.Platform,
  ) {}

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

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writes.then(operation);
    this.writes = result.then(
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
      await this.requireSecureStorage();
      const encrypted = await this.storage.encryptStringAsync(password);
      if (!Buffer.isBuffer(encrypted) || encrypted.length < 1 || encrypted.length > 16 * 1024)
        throw new AppFailure('vault-unavailable');
      await this.writeEncrypted(path, encrypted);
    });
  }

  getPassword(identityId: string): Promise<string | undefined> {
    const path = this.path(identityId);
    return this.serialize(async () => {
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
        if (!decrypted.result || decrypted.result.length > 4096)
          throw new AppFailure('vault-corrupt');
        if (decrypted.shouldReEncrypt) {
          const rotated = await this.storage.encryptStringAsync(decrypted.result);
          await this.writeEncrypted(path, rotated);
        }
        return decrypted.result;
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
}
