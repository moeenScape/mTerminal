import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, open, realpath, rename, unlink, type FileHandle } from 'node:fs/promises';
import type { Client, SFTPWrapper, Stats } from 'ssh2';
import type { FileErrorCode } from '../../shared/files.js';
import type {
  TransferRequest,
  TransferCheckpoint,
  TransferConflictPreview,
  TransferFileInfo,
} from '../../shared/transfers.js';
import {
  localFileInfo,
  remoteFileInfo,
  sameFileInfo,
  conflictPreview,
  TransferConflict,
} from './transfer-conflict.js';
import { childPath } from './operations.js';
import { FileBrowserError, fileErrorCode, fileKind } from './listing.js';
import { sftpRequest } from './sftp-request.js';

export class TransferFailure extends FileBrowserError {
  constructor(
    code: FileErrorCode,
    readonly partialPath: string | null,
    readonly backupPath: string | null = null,
  ) {
    super(code);
  }
}
export interface TransferOutcome {
  partialPath: string | null;
  backupPath?: string;
  source?: TransferFileInfo;
  destination?: TransferFileInfo;
}

/** Bounded copying into an exclusive staging file; publish only after successful close. */
export async function transferFile(
  client: Client,
  job: TransferRequest,
  signal: AbortSignal,
  progress: (transferred: number, total: number) => void,
  approval?: TransferConflictPreview,
  limits?: { maxBytes: number },
  checkpoint?: (value: TransferCheckpoint) => void,
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
  let backupPath: string | null = null;
  let rollback: (() => Promise<void>) | undefined;
  let restored = false;
  let sourceInfo: TransferFileInfo | undefined;
  let destinationInfo: TransferFileInfo | undefined;
  const lost = new AbortController();
  const combined = AbortSignal.any([signal, lost.signal]);
  const disconnected = () => lost.abort(new FileBrowserError('disconnected'));
  const rpc = <T>(invoke: (done: (error: Error | undefined, value: T) => void) => void) =>
    sftpRequest(combined, invoke, 30000);
  const call = (invoke: (done: (error: Error | null | undefined) => void) => void) =>
    rpc<void>((done) => invoke((error) => done(error ?? undefined, undefined)));
  const cleanup = <T>(invoke: (done: (error: Error | undefined, value: T) => void) => void) =>
    sftpRequest(new AbortController().signal, invoke, 5000);
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
    const source = upload
      ? localFileInfo(localPath, await lstat(localPath))
      : remoteFileInfo(remotePath, await rpc<Stats>((done) => sftp.lstat(remotePath, done)));
    if (source.kind !== 'file') throw new FileBrowserError('unsupported');
    if (
      limits &&
      (!Number.isSafeInteger(source.size) || source.size < 0 || source.size > limits.maxBytes)
    )
      throw new FileBrowserError('editor-text-only');
    sourceInfo = source;
    const readDestination = async (): Promise<TransferFileInfo | null> => {
      try {
        return upload
          ? remoteFileInfo(remotePath, await rpc<Stats>((done) => sftp.lstat(remotePath, done)))
          : localFileInfo(localPath, await lstat(localPath));
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        if (code === 2 || code === 'ENOENT') return null;
        throw error;
      }
    };
    const destination = await readDestination();
    const replacing = !!(
      approval &&
      destination &&
      approval.replaceable &&
      destination.kind === 'file' &&
      sameFileInfo(approval.destination, destination) &&
      sameFileInfo(approval.source, source)
    );
    if (destination && !replacing) throw new TransferConflict(conflictPreview(source, destination));
    if (approval && !destination) throw new FileBrowserError('destination-changed');
    let staging: TransferFileInfo | undefined;
    const record = (phase: TransferCheckpoint['phase'], plannedBackup = backupPath) =>
      checkpoint?.({
        phase,
        partialPath: stage,
        backupPath: plannedBackup,
        source,
        destination,
        ...(staging ? { staging } : {}),
      });
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
      if (
        !stats.isFile() ||
        stats.dev !== expected.dev ||
        stats.ino !== expected.ino ||
        !sameFileInfo(source, localFileInfo(localPath, stats))
      )
        throw new FileBrowserError('source-changed');
      size = stats.size;
      modified = stats.mtimeMs;
      stage = childPath(remoteParent, `.mterminal-${randomUUID()}.part`, true);
      record('staging');
      remoteHandle = await rpc<Buffer>((done) => sftp.open(stage!, 'wx', 0o600, done));
      stageCreated = true;
      staging = remoteFileInfo(stage, await rpc<Stats>((done) => sftp.fstat(remoteHandle!, done)));
      record('staging');
    } else {
      const expected = await rpc<Stats>((done) => sftp.lstat(remotePath, done));
      if (fileKind(expected.mode) !== 'file') throw new FileBrowserError('unsupported');
      remoteHandle = await rpc<Buffer>((done) => sftp.open(remotePath, 'r', done));
      const stats = await rpc<Stats>((done) => sftp.fstat(remoteHandle!, done));
      if (
        fileKind(stats.mode) !== 'file' ||
        stats.size !== expected.size ||
        stats.mtime !== expected.mtime ||
        !sameFileInfo(source, remoteFileInfo(remotePath, stats))
      )
        throw new FileBrowserError('source-changed');
      size = stats.size;
      modified = stats.mtime;
      stage = childPath(localParent, `.mterminal-${randomUUID()}.part`, false);
      record('staging');
      local = await open(stage, 'wx', 0o600);
      stageCreated = true;
      staging = localFileInfo(stage, await local.stat());
      record('staging');
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
      destinationInfo = remoteFileInfo(remotePath, destination);
    } else {
      const after = await rpc<Stats>((done) => sftp.fstat(remoteHandle!, done));
      if (after.size !== size || after.mtime !== modified)
        throw new FileBrowserError('source-changed');
      await local.sync();
      destinationInfo = localFileInfo(localPath, await local.stat());
    }
    await local.close();
    local = undefined;
    await call((done) => sftp.close(remoteHandle!, done));
    remoteHandle = undefined;
    if (combined.aborted) throw combined.reason;
    const current = await readDestination();
    if (current && (!replacing || !approval || !sameFileInfo(current, approval.destination)))
      throw new TransferConflict(conflictPreview(source, current));
    if (replacing && !current) throw new FileBrowserError('destination-changed');
    publishing = true;
    if (replacing && approval) {
      const backup = childPath(
        upload ? remoteParent : localParent,
        `.mterminal-${randomUUID()}.bak`,
        upload,
      );
      record('backup', backup);
      if (upload) {
        backupPath = backup;
        await call((done) => sftp.rename(remotePath, backup, done));
        rollback = async () => {
          await cleanup<void>((done) =>
            sftp.rename(backup, remotePath, (error) => done(error ?? undefined, undefined)),
          );
          backupPath = null;
        };
        const moved = remoteFileInfo(
          remotePath,
          await rpc<Stats>((done) => sftp.lstat(backup, done)),
        );
        if (!sameFileInfo(moved, approval.destination))
          throw new FileBrowserError('destination-changed');
      } else {
        // Reserve exclusively and verify hard-link support before moving the old destination.
        await link(stage!, backup);
        backupPath = backup;
        const identity = await lstat(backup);
        try {
          await rename(localPath, backup);
        } catch (error) {
          const remaining = await lstat(backup).catch(() => undefined);
          if (remaining?.dev === identity.dev && remaining.ino === identity.ino) {
            await unlink(backup);
            backupPath = null;
          }
          throw error;
        }
        rollback = async () => {
          await link(backup, localPath);
        };
        const moved = localFileInfo(localPath, await lstat(backup));
        if (!sameFileInfo(moved, approval.destination))
          throw new FileBrowserError('destination-changed');
      }
    }
    if (combined.aborted) throw combined.reason;
    record('publishing');
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
    if (failure && rollback && !published) {
      try {
        await rollback();
        restored = true;
      } catch {
        /* The backup remains for explicit recovery. */
      }
    }
    // Cleanup gets its own short deadline so cancelling a copy can still remove its staging file.
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
    if (failure instanceof TransferConflict)
      throw new TransferConflict(failure.preview, partialPath, backupPath);
    const code = fileErrorCode(failure);
    throw new TransferFailure(
      publishing &&
        !restored &&
        job.direction === 'upload' &&
        (combined.aborted || code === 'transfer-timeout')
        ? 'uncertain'
        : code === 'unavailable'
          ? 'transfer-failed'
          : code,
      partialPath,
      backupPath,
    );
  }
  if (!published) throw new TransferFailure('transfer-failed', partialPath);
  return {
    partialPath,
    ...(backupPath ? { backupPath } : {}),
    ...(sourceInfo ? { source: sourceInfo } : {}),
    ...(destinationInfo ? { destination: destinationInfo } : {}),
  };
}
