import { opendir, lstat, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, parse, posix, sep } from 'node:path';
import {
  FILE_LIST_LIMIT,
  type DirectoryListing,
  type FileEntry,
  type FileErrorCode,
} from '../../shared/files.js';
import { validTerminalId } from '../../shared/terminal.js';
import type { FileListRequest } from '../../shared/files.js';

export class FileBrowserError extends Error {
  constructor(readonly code: FileErrorCode) {
    super(code);
  }
}
export function fileErrorCode(error: unknown): FileErrorCode {
  if (error instanceof FileBrowserError) return error.code;
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'EACCES' || code === 'EPERM' || code === 3) return 'permission';
  if (code === 'ENOENT' || code === 2) return 'missing';
  if (code === 'ENOTDIR') return 'directory';
  return 'unavailable';
}
export function validFileRequest(value: unknown): value is FileListRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  if (typeof request.path !== 'string' || request.path.length > 4096 || request.path.includes('\0'))
    return false;
  if (request.side === 'local')
    return Object.keys(request).length === 2 && (!request.path || isAbsolute(request.path));
  return (
    request.side === 'remote' &&
    Object.keys(request).length === 3 &&
    validTerminalId(request.sessionId) &&
    (!request.path || posix.isAbsolute(request.path))
  );
}
export function fileKind(mode: number): FileEntry['kind'] {
  switch (mode & 0o170000) {
    case 0o040000:
      return 'directory';
    case 0o100000:
      return 'file';
    case 0o120000:
      return 'symlink';
    default:
      return 'other';
  }
}
export function directoryListing(
  path: string,
  entries: FileEntry[],
  truncated: boolean,
  remote: boolean,
): DirectoryListing {
  const paths = remote ? posix : { dirname, parse, sep, join };
  const root = paths.parse(path).root;
  const breadcrumbs = [{ name: root, path: root }];
  let current = root;
  for (const name of path.slice(root.length).split(paths.sep).filter(Boolean)) {
    current = paths.join(current, name);
    breadcrumbs.push({ name, path: current });
  }
  return { path, parent: paths.dirname(path), breadcrumbs, entries, truncated };
}
export async function listLocalDirectory(requested: string): Promise<DirectoryListing> {
  const path = await realpath(requested || homedir());
  const directory = await opendir(path);
  const entries: FileEntry[] = [];
  let truncated = false;
  for await (const entry of directory) {
    if (entries.length === FILE_LIST_LIMIT) {
      truncated = true;
      break;
    }
    const child = join(path, entry.name);
    try {
      const stats = await lstat(child);
      entries.push({
        name: entry.name,
        path: child,
        kind: fileKind(stats.mode),
        size: stats.size,
        modified: stats.mtimeMs,
        permissions: (stats.mode & 0o7777).toString(8).padStart(4, '0'),
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return directoryListing(path, entries, truncated, false);
}
