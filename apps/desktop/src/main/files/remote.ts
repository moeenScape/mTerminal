import { posix } from 'node:path';
import type { Client, SFTPWrapper } from 'ssh2';
import { FILE_LIST_LIMIT, type DirectoryListing, type FileEntry } from '../../shared/files.js';
import { directoryListing, fileKind, FileBrowserError } from './listing.js';

function request<T>(
  signal: AbortSignal,
  invoke: (done: (error: Error | undefined, value: T) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new FileBrowserError('disconnected'));
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    try {
      invoke((error, value) => {
        signal.removeEventListener('abort', abort);
        if (error) reject(error);
        else resolve(value);
      });
    } catch (error) {
      signal.removeEventListener('abort', abort);
      reject(error);
    }
  });
}

/** Each listing owns a short-lived SFTP channel on the already verified SSH connection. */
export class RemoteFileBrowser {
  private pending: AbortController | undefined;
  private closed = false;
  constructor(private readonly client: Client) {}
  dispose(): void {
    this.closed = true;
    this.pending?.abort();
  }
  async list(path: string): Promise<DirectoryListing> {
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
      const channel = sftp;
      const canonical = await request<string>(controller.signal, (done) =>
        channel.realpath(path || '.', done),
      );
      if (!posix.isAbsolute(canonical) || canonical.includes('\0') || canonical.length > 4096)
        throw new FileBrowserError('unavailable');
      const handle = await request<Buffer>(controller.signal, (done) =>
        channel.opendir(canonical, done),
      );
      const entries: FileEntry[] = [];
      let truncated = false;
      try {
        while (true) {
          const batch = await request<import('ssh2').FileEntryWithStats[] | null>(
            controller.signal,
            (done) =>
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
        if (!controller.signal.aborted)
          await request<void>(controller.signal, (done) =>
            channel.close(handle, (error) => done(error ?? undefined, undefined)),
          );
      }
      return directoryListing(canonical, entries, truncated, true);
    } catch (error) {
      if (timedOut) throw new FileBrowserError('unavailable');
      throw error;
    } finally {
      clearTimeout(timer);
      sftp?.removeListener('close', close);
      sftp?.removeListener('error', close);
      controller.signal.removeEventListener('abort', stop);
      // Keep an error listener until the channel finishes shutting down.
      sftp?.on('error', () => {});
      sftp?.destroy();
      this.pending = undefined;
    }
  }
}
