import { posix } from 'node:path';
import type { Client, SFTPWrapper } from 'ssh2';
import {
  FILE_LIST_LIMIT,
  type DirectoryListing,
  type FileEntry,
  type FileOperation,
} from '../../shared/files.js';
import { directoryListing, fileKind, FileBrowserError } from './listing.js';
import { inspectPartial } from './partial-cleanup.js';
import { childPath } from './operations.js';
import { sftpRequest as request } from './sftp-request.js';
import { transferFile, type TransferOutcome } from './transfer-file.js';
import type {
  TransferRequest,
  TransferConflictPreview,
  TransferCheckpoint,
  TransferRecoveryRecord,
  PartialInspection,
} from '../../shared/transfers.js';
import { REMOTE_EDIT_MAX_BYTES, type RemoteEditRequest } from '../../shared/remote-edit.js';

/** Each operation owns a short-lived SFTP channel on the verified SSH connection. */
export class RemoteFileBrowser {
  private pending: AbortController | undefined;
  private closed = false;
  private readonly lifetime = new AbortController();
  constructor(private readonly client: Client) {}
  dispose(): void {
    this.closed = true;
    this.lifetime.abort(new FileBrowserError('disconnected'));
    this.pending?.abort();
  }
  transfer(
    request: TransferRequest,
    signal: AbortSignal,
    progress: (transferred: number, total: number) => void,
    approval?: TransferConflictPreview,
    checkpoint?: (value: TransferCheckpoint) => void,
  ): Promise<TransferOutcome> {
    if (this.closed) return Promise.reject(new FileBrowserError('disconnected'));
    return transferFile(
      this.client,
      request,
      AbortSignal.any([signal, this.lifetime.signal]),
      progress,
      approval,
      undefined,
      checkpoint,
    );
  }
  prepareEdit(
    request: RemoteEditRequest,
    directory: string,
    signal: AbortSignal,
  ): Promise<TransferOutcome> {
    if (this.closed) return Promise.reject(new FileBrowserError('disconnected'));
    return transferFile(
      this.client,
      { ...request, localDirectory: directory, direction: 'download' },
      AbortSignal.any([signal, this.lifetime.signal]),
      () => {},
      undefined,
      { maxBytes: REMOTE_EDIT_MAX_BYTES },
    );
  }
  recoverPartial(
    record: TransferRecoveryRecord,
    signal: AbortSignal,
    expected?: PartialInspection,
  ): Promise<PartialInspection> {
    return this.withChannel(
      (channel, combined) => inspectPartial(channel, combined, record, expected),
      !!expected,
      signal,
    );
  }
  private async withChannel<T>(
    operation: (channel: SFTPWrapper, signal: AbortSignal) => Promise<T>,
    mutating = false,
    signal?: AbortSignal,
  ): Promise<T> {
    if (this.closed) throw new FileBrowserError('disconnected');
    if (this.pending) throw new FileBrowserError('busy');
    const controller = new AbortController();
    this.pending = controller;
    let sftp: SFTPWrapper | undefined;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 15000);
    const close = () => controller.abort();
    signal?.addEventListener('abort', close, { once: true });
    if (signal?.aborted) controller.abort();
    const stop = () => {
      sftp?.destroy();
    };
    controller.signal.addEventListener('abort', stop, { once: true });
    try {
      sftp = await request<SFTPWrapper>(controller.signal, (done) =>
        this.client.sftp((error, channel) => {
          if (controller.signal.aborted) {
            channel?.on('error', () => {});
            channel?.destroy();
            return;
          }
          done(error, channel);
        }),
      );
      sftp.on('error', close);
      sftp.on('close', close);
      return await operation(sftp, controller.signal);
    } catch (error) {
      if (mutating && (controller.signal.aborted || timedOut))
        throw new FileBrowserError('uncertain');
      if (timedOut) throw new FileBrowserError('unavailable');
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', close);
      sftp?.removeListener('close', close);
      sftp?.removeListener('error', close);
      controller.signal.removeEventListener('abort', stop);
      // Keep an error listener until the channel finishes shutting down.
      sftp?.on('error', () => {});
      sftp?.destroy();
      this.pending = undefined;
    }
  }
  list(path: string): Promise<DirectoryListing> {
    return this.withChannel(async (channel, signal) => {
      const canonical = await request<string>(signal, (done) =>
        channel.realpath(path || '.', done),
      );
      if (!posix.isAbsolute(canonical) || canonical.includes('\0') || canonical.length > 4096)
        throw new FileBrowserError('unavailable');
      const handle = await request<Buffer>(signal, (done) => channel.opendir(canonical, done));
      const entries: FileEntry[] = [];
      let truncated = false;
      try {
        while (true) {
          const batch = await request<import('ssh2').FileEntryWithStats[] | null>(signal, (done) =>
            channel.readdir(handle, (error, entries) => {
              // Handle-based READDIR reports SFTP EOF as status 1, not an empty array.
              if ((error as (Error & { code?: number }) | undefined)?.code === 1)
                done(undefined, null);
              else done(error, entries);
            }),
          );
          if (batch === null) break;
          for (const entry of batch) {
            if (entry.filename === '.' || entry.filename === '..') continue;
            if (!entry.filename || entry.filename.includes('/') || entry.filename.includes('\0'))
              throw new FileBrowserError('unavailable');
            if (entries.length === FILE_LIST_LIMIT) {
              truncated = true;
              break;
            }
            entries.push({
              name: entry.filename,
              path: posix.join(canonical, entry.filename),
              kind: fileKind(entry.attrs.mode),
              size: entry.attrs.size,
              modified: entry.attrs.mtime * 1000,
              permissions: (entry.attrs.mode & 0o7777).toString(8).padStart(4, '0'),
            });
          }
          if (truncated) break;
        }
      } finally {
        if (!signal.aborted)
          await request<void>(signal, (done) =>
            channel.close(handle, (error) => done(error ?? undefined, undefined)),
          );
      }
      return directoryListing(canonical, entries, truncated, true);
    });
  }
  mutate(parent: string, operation: FileOperation): Promise<void> {
    return this.withChannel(async (channel, signal) => {
      const canonical = await request<string>(signal, (done) => channel.realpath(parent, done));
      const path = childPath(canonical, operation.name, true);
      const call = (invoke: (done: (error: Error | null | undefined) => void) => void) =>
        request<void>(signal, (done) => invoke((error) => done(error ?? undefined, undefined)));
      if (operation.action === 'mkdir') {
        await call((done) => channel.mkdir(path, done));
        return;
      }
      const stats = await request<import('ssh2').Stats>(signal, (done) =>
        channel.lstat(path, done),
      );
      const kind = fileKind(stats.mode);
      if (kind === 'other') throw new FileBrowserError('unsupported');
      if (operation.action === 'delete') {
        if (kind === 'directory') await call((done) => channel.rmdir(path, done));
        else await call((done) => channel.unlink(path, done));
      } else if (operation.action === 'chmod') {
        if (kind === 'symlink') throw new FileBrowserError('unsupported');
        await call((done) => channel.chmod(path, Number.parseInt(operation.mode, 8), done));
      } else {
        const destination = childPath(canonical, operation.newName, true);
        const exists = await request<boolean>(signal, (done) =>
          channel.lstat(destination, (error) => {
            if (!error) done(undefined, true);
            else if ((error as Error & { code?: number }).code === 2) done(undefined, false);
            else done(error, false);
          }),
        );
        if (exists) throw new FileBrowserError('exists');
        // Standard SFTP rename refuses an existing target; do not use the overwrite extension.
        await call((done) => channel.rename(path, destination, done));
      }
    }, true);
  }
}
