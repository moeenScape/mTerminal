import { constants } from 'node:fs';
import { link, lstat, mkdir, open, realpath, rename, rmdir, unlink } from 'node:fs/promises';
import { isAbsolute, join, posix } from 'node:path';
import type { FileMutationRequest, FileOperation } from '../../shared/files.js';
import { validFileName } from '../../shared/files.js';
import { FileBrowserError, validFileRequest } from './listing.js';

export function validMutationRequest(value: unknown): value is FileMutationRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const { operation, ...location } = value as Record<string, unknown>;
  if (
    !validFileRequest(location) ||
    !location.path ||
    !operation ||
    typeof operation !== 'object' ||
    Array.isArray(operation)
  )
    return false;
  const op = operation as Record<string, unknown>;
  if (!validFileName(op.name)) return false;
  if (
    location.side === 'local' &&
    process.platform === 'win32' &&
    [op.name, op.newName].some(
      (name) =>
        typeof name === 'string' &&
        /[<>:"|?*]|[. ]$|^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name),
    )
  )
    return false;
  if (op.action === 'mkdir' || op.action === 'delete') return Object.keys(op).length === 2;
  if (op.action === 'rename')
    return Object.keys(op).length === 3 && validFileName(op.newName) && op.newName !== op.name;
  return (
    op.action === 'chmod' &&
    Object.keys(op).length === 3 &&
    typeof op.mode === 'string' &&
    /^[0-7]{3,4}$/.test(op.mode)
  );
}

export function childPath(parent: string, name: string, remote: boolean): string {
  const child = remote ? posix.join(parent, name) : join(parent, name);
  if (
    !validFileName(name) ||
    parent.includes('\0') ||
    child.length > 4096 ||
    !(remote ? posix.isAbsolute(parent) : isAbsolute(parent))
  )
    throw new FileBrowserError('unsupported');
  return child;
}

export async function mutateLocalDirectory(
  parent: string,
  operation: FileOperation,
): Promise<void> {
  const canonical = await realpath(parent);
  const path = childPath(canonical, operation.name, false);
  if (operation.action === 'mkdir') {
    await mkdir(path);
    return;
  }
  const stats = await lstat(path);
  if (operation.action === 'delete') {
    if (stats.isDirectory()) await rmdir(path);
    else if (stats.isFile() || stats.isSymbolicLink()) await unlink(path);
    else throw new FileBrowserError('unsupported');
    return;
  }
  if (operation.action === 'chmod') {
    if (
      process.platform === 'win32' ||
      stats.isSymbolicLink() ||
      (!stats.isFile() && !stats.isDirectory())
    )
      throw new FileBrowserError('unsupported');
    const handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const current = await handle.stat();
      if (current.dev !== stats.dev || current.ino !== stats.ino)
        throw new FileBrowserError('unsupported');
      await handle.chmod(Number.parseInt(operation.mode, 8));
    } finally {
      await handle.close();
    }
    return;
  }
  const destination = childPath(canonical, operation.newName, false);
  if (stats.isDirectory()) {
    // Reserve an empty directory: renaming a directory cannot replace file data or a nonempty folder.
    await mkdir(destination, { mode: 0o700 });
    const reservation = await lstat(destination);
    try {
      await rename(path, destination);
    } catch (error) {
      const current = await lstat(destination).catch(() => undefined);
      if (current?.dev === reservation.dev && current.ino === reservation.ino)
        await rmdir(destination).catch(() => {});
      throw error;
    }
  } else if (stats.isFile() || stats.isSymbolicLink()) {
    // Hard-link creation refuses an existing destination atomically; fs.rename could overwrite it.
    await link(path, destination);
    try {
      await unlink(path);
    } catch {
      throw new FileBrowserError('partial');
    }
  } else throw new FileBrowserError('unsupported');
}
