import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath, unlink, type FileHandle } from 'node:fs/promises';
import { basename, dirname, posix } from 'node:path';
import type { SFTPWrapper, Stats } from 'ssh2';
import type { PartialInspection, TransferRecoveryRecord } from '../../shared/transfers.js';
import { localFileInfo, remoteFileInfo, sameFileInfo } from './transfer-conflict.js';
import { FileBrowserError } from './listing.js';
import { childPath } from './operations.js';
import { sftpRequest } from './sftp-request.js';

/** Verify the created staging identity and source prefix again on every confirmed deletion. */
export async function inspectPartial(
  channel: SFTPWrapper,
  signal: AbortSignal,
  record: TransferRecoveryRecord,
  expected?: PartialInspection,
): Promise<PartialInspection> {
  const reject = () => new FileBrowserError('recovery-unverified');
  const rpc = <T>(invoke: (done: (error: Error | undefined, value: T) => void) => void) =>
    sftpRequest(signal, invoke);
  const path = record.partialPath;
  const created = record.staging;
  const upload = record.direction === 'upload';
  if (!path || !created || !record.source || created.path !== path || created.size !== 0)
    throw reject();
  const localParent = await realpath(record.localDirectory);
  const remoteParent = await rpc<string>((done) => channel.realpath(record.remoteDirectory, done));
  const sourcePath = childPath(upload ? localParent : remoteParent, record.name, !upload);
  const destinationPath = childPath(upload ? remoteParent : localParent, record.name, upload);
  const paths = upload ? posix : { dirname, basename };
  // Only the generated .part sibling is eligible; destination and backup names are never actions.
  if (
    paths.dirname(path) !== (upload ? remoteParent : localParent) ||
    !/^\.mterminal-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.part$/.test(
      paths.basename(path),
    ) ||
    path === sourcePath ||
    path === destinationPath ||
    path === record.backupPath ||
    sourcePath !== record.source.path
  )
    throw reject();

  const localPath = upload ? sourcePath : path;
  const remotePath = upload ? path : sourcePath;
  let local: FileHandle | undefined;
  let remote: Buffer | undefined;
  try {
    const localBefore = localFileInfo(localPath, await lstat(localPath));
    const remoteBefore = remoteFileInfo(
      remotePath,
      await rpc<Stats>((done) => channel.lstat(remotePath, done)),
    );
    if (localBefore.kind !== 'file' || remoteBefore.kind !== 'file') throw reject();
    local = await open(localPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    remote = await rpc<Buffer>((done) => channel.open(remotePath, 'r', done));
    const localStats = await local.stat();
    const remoteStats = await rpc<Stats>((done) => channel.fstat(remote!, done));
    const localInfo = localFileInfo(localPath, localStats);
    const remoteInfo = remoteFileInfo(remotePath, remoteStats);
    if (!sameFileInfo(localBefore, localInfo) || !sameFileInfo(remoteBefore, remoteInfo))
      throw reject();
    const file = upload ? remoteInfo : localInfo;
    const source = upload ? localInfo : remoteInfo;
    const initial = created.version.split(':');
    const current = file.version.split(':');
    const identity = upload ? [2, 3, 4] : [0, 1, 4, 5, 6];
    if (
      file.kind !== 'file' ||
      created.kind !== 'file' ||
      file.permissions !== '0600' ||
      !identity.every(
        (index) => /^\d+$/.test(initial[index] ?? '') && initial[index] === current[index],
      ) ||
      !sameFileInfo(source, record.source) ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      file.size > source.size
    )
      throw reject();

    const digest = createHash('sha256');
    const localBuffer = Buffer.alloc(64 * 1024);
    const remoteBuffer = Buffer.alloc(localBuffer.length);
    let position = 0;
    while (position < file.size) {
      signal.throwIfAborted();
      const length = Math.min(localBuffer.length, file.size - position);
      let localRead = 0;
      let remoteRead = 0;
      while (localRead < length) {
        signal.throwIfAborted();
        const count = (
          await local.read(localBuffer, localRead, length - localRead, position + localRead)
        ).bytesRead;
        if (!count) throw reject();
        localRead += count;
      }
      while (remoteRead < length) {
        const offset = remoteRead;
        const count = await rpc<number>((done) =>
          channel.read(
            remote!,
            remoteBuffer,
            offset,
            length - offset,
            position + offset,
            (error, count) => done(error ?? undefined, count),
          ),
        );
        if (!Number.isInteger(count) || count <= 0 || count > length - remoteRead) throw reject();
        remoteRead += count;
      }
      if (!localBuffer.subarray(0, length).equals(remoteBuffer.subarray(0, length))) throw reject();
      digest.update(localBuffer.subarray(0, length));
      position += length;
    }
    const afterLocal = localFileInfo(localPath, await local.stat());
    const afterRemote = remoteFileInfo(
      remotePath,
      await rpc<Stats>((done) => channel.fstat(remote!, done)),
    );
    const namedLocal = localFileInfo(localPath, await lstat(localPath));
    const namedRemote = remoteFileInfo(
      remotePath,
      await rpc<Stats>((done) => channel.lstat(remotePath, done)),
    );
    if (
      ![afterLocal, namedLocal].every((value) => sameFileInfo(value, localInfo)) ||
      ![afterRemote, namedRemote].every((value) => sameFileInfo(value, remoteInfo))
    )
      throw reject();
    const result = { file, digest: digest.digest('hex') };
    signal.throwIfAborted();
    if (expected) {
      if (!sameFileInfo(expected.file, file) || expected.digest !== result.digest)
        throw new FileBrowserError('recovery-stale');
      // shortcut: SFTP lacks conditional unlink; use an atomic server operation if one becomes available.
      if (upload)
        await rpc<void>((done) =>
          channel.unlink(path, (error) => done(error ?? undefined, undefined)),
        );
      else await unlink(path);
    }
    return result;
  } finally {
    await local?.close().catch(() => {});
    if (remote && !signal.aborted)
      await rpc<void>((done) =>
        channel.close(remote!, (error) => done(error ?? undefined, undefined)),
      ).catch(() => {});
  }
}
