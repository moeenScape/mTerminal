import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, open, realpath, unlink, type FileHandle } from 'node:fs/promises';
import type { Client, SFTPWrapper, Stats } from 'ssh2';
import type { FileErrorCode } from '../../shared/files.js';
import type { TransferRequest } from '../../shared/transfers.js';
import { childPath } from './operations.js';
import { FileBrowserError, fileErrorCode, fileKind } from './listing.js';
import { sftpRequest } from './sftp-request.js';

export class TransferFailure extends FileBrowserError {
  constructor(
    code: FileErrorCode,
    readonly partialPath: string | null,
  ) {
    super(code);
  }
}
export interface TransferOutcome {
  partialPath: string | null;
}

/** Bounded copying into an exclusive staging file; publish only after successful close. */
export async function transferFile(
  client: Client,
  job: TransferRequest,
  signal: AbortSignal,
  progress: (transferred: number, total: number) => void,
): Promise<TransferOutcome> {
  let channel: SFTPWrapper | undefined;
  let local: FileHandle | undefined;
  let remoteHandle: Buffer | undefined;
  let stage: string | null = null;
  let stageCreated = false;
  let finished = false;
  let publishing = false;
  let published = false;
  let failure: unknown;
  let partialPath: string | null = null;
  const lost = new AbortController();
  const combined = AbortSignal.any([signal, lost.signal]);
  const disconnected = () => lost.abort(new FileBrowserError('disconnected'));
  const rpc = <T>(invoke: (done: (error: Error | undefined, value: T) => void) => void) =>
    sftpRequest(combined, invoke, 30000);
  const call = (invoke: (done: (error: Error | null | undefined) => void) => void) =>
    rpc<void>((done) => invoke((error) => done(error ?? undefined, undefined)));
  try {
    channel = await rpc<SFTPWrapper>((done) =>
      client.sftp((error, sftp) => {
        if (finished || combined.aborted) {
          sftp?.on('error', () => {});
          sftp?.destroy();
          return;
        }
        channel = sftp;
        sftp?.on('error', disconnected);
        sftp?.on('close', disconnected);
        done(error, sftp);
      }),
    );
    const sftp = channel;
    const localParent = await realpath(job.localDirectory);
    const remoteParent = await rpc<string>((done) => sftp.realpath(job.remoteDirectory, done));
    const localPath = childPath(localParent, job.name, false);
    const remotePath = childPath(remoteParent, job.name, true);
    const upload = job.direction === 'upload';
    if (upload) {
      await rpc<void>((done) =>
        sftp.lstat(remotePath, (error) => {
          if (!error) done(new FileBrowserError('exists'), undefined);
          else if ((error as Error & { code?: number }).code === 2) done(undefined, undefined);
          else done(error, undefined);
        }),
      );
    } else {
      const existing = await lstat(localPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        return undefined;
      });
      if (existing) throw new FileBrowserError('exists');
    }
    let size: number;
    let modified: number;
    if (upload) {
      const expected = await lstat(localPath);
      if (!expected.isFile()) throw new FileBrowserError('unsupported');
      local = await open(
        localPath,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      const stats = await local.stat();
      if (!stats.isFile() || stats.dev !== expected.dev || stats.ino !== expected.ino)
        throw new FileBrowserError('source-changed');
      size = stats.size;
      modified = stats.mtimeMs;
      stage = childPath(remoteParent, `.mterminal-${randomUUID()}.part`, true);
      remoteHandle = await rpc<Buffer>((done) => sftp.open(stage!, 'wx', 0o600, done));
      stageCreated = true;
    } else {
      const expected = await rpc<Stats>((done) => sftp.lstat(remotePath, done));
      if (fileKind(expected.mode) !== 'file') throw new FileBrowserError('unsupported');
      remoteHandle = await rpc<Buffer>((done) => sftp.open(remotePath, 'r', done));
      const stats = await rpc<Stats>((done) => sftp.fstat(remoteHandle!, done));
      if (
        fileKind(stats.mode) !== 'file' ||
        stats.size !== expected.size ||
        stats.mtime !== expected.mtime
      )
        throw new FileBrowserError('source-changed');
      size = stats.size;
      modified = stats.mtime;
      stage = childPath(localParent, `.mterminal-${randomUUID()}.part`, false);
      local = await open(stage, 'wx', 0o600);
      stageCreated = true;
    }
    if (!Number.isSafeInteger(size) || size < 0) throw new FileBrowserError('unsupported');
    progress(0, size);
    // shortcut: one chunk in flight bounds memory and cancellation; tune after measuring throughput.
    const buffer = Buffer.alloc(64 * 1024);
    let position = 0;
    while (position < size) {
      if (combined.aborted) throw combined.reason;
      const length = Math.min(buffer.length, size - position);
      const count = upload
        ? (await local.read(buffer, 0, length, position)).bytesRead
        : await rpc<number>((done) =>
            sftp.read(remoteHandle!, buffer, 0, length, position, (error, bytesRead) =>
              done(
                (error as (Error & { code?: number }) | undefined)?.code === 1
                  ? new FileBrowserError('source-changed')
                  : (error ?? undefined),
                bytesRead,
              ),
            ),
          );
      if (!Number.isInteger(count) || count <= 0 || count > length)
        throw new FileBrowserError('source-changed');
      if (upload) await call((done) => sftp.write(remoteHandle!, buffer, 0, count, position, done));
      else {
        let written = 0;
        while (written < count) {
          if (combined.aborted) throw combined.reason;
          const result = await local.write(buffer, written, count - written, position + written);
          if (!result.bytesWritten) throw new FileBrowserError('transfer-failed');
          written += result.bytesWritten;
        }
      }
      position += count;
      progress(position, size);
    }
    if (upload) {
      const after = await local.stat();
      if (after.size !== size || after.mtimeMs !== modified)
        throw new FileBrowserError('source-changed');
      const destination = await rpc<Stats>((done) => sftp.fstat(remoteHandle!, done));
      if (destination.size !== size) throw new FileBrowserError('transfer-failed');
    } else {
      const after = await rpc<Stats>((done) => sftp.fstat(remoteHandle!, done));
      if (after.size !== size || after.mtime !== modified)
        throw new FileBrowserError('source-changed');
      await local.sync();
    }
    await local.close();
    local = undefined;
    await call((done) => sftp.close(remoteHandle!, done));
    remoteHandle = undefined;
    if (combined.aborted) throw combined.reason;
    publishing = true;
    if (upload) {
      await call((done) => sftp.rename(stage!, remotePath, done));
      stageCreated = false;
    } else await link(stage!, localPath);
    published = true;
  } catch (error) {
    failure = error;
    if (
      job.direction === 'upload' &&
      stage &&
      !stageCreated &&
      (combined.aborted || fileErrorCode(error) === 'transfer-timeout')
    )
      partialPath = stage;
  } finally {
    finished = true;
    // Cleanup gets its own short deadline so cancelling a copy can still remove its staging file.
    const cleanup = <T>(invoke: (done: (error: Error | undefined, value: T) => void) => void) =>
      sftpRequest(new AbortController().signal, invoke, 5000);
    if (local) await local.close().catch(() => {});
    if (channel && remoteHandle)
      await cleanup<void>((done) =>
        channel!.close(remoteHandle!, (error) => done(error ?? undefined, undefined)),
      ).catch(() => {});
    if (stageCreated && stage) {
      try {
        if (job.direction === 'upload' && channel)
          await cleanup<void>((done) =>
            channel!.unlink(stage!, (error) => done(error ?? undefined, undefined)),
          );
        else await unlink(stage);
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        if (code !== 'ENOENT' && code !== 2) partialPath = stage;
      }
    }
    channel?.removeListener('close', disconnected);
    channel?.removeListener('error', disconnected);
    channel?.on('error', () => {});
    channel?.destroy();
  }
  if (failure) {
    const code = fileErrorCode(failure);
    throw new TransferFailure(
      publishing && job.direction === 'upload' && (combined.aborted || code === 'transfer-timeout')
        ? 'uncertain'
        : code === 'unavailable'
          ? 'transfer-failed'
          : code,
      partialPath,
    );
  }
  if (!published) throw new TransferFailure('transfer-failed', partialPath);
  return { partialPath };
}
