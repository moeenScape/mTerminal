import { randomUUID } from 'node:crypto';
import type { Stats as LocalStats } from 'node:fs';
import type { Stats as RemoteStats } from 'ssh2';
import type { TransferConflictPreview, TransferFileInfo } from '../../shared/transfers.js';
import { FileBrowserError, fileKind } from './listing.js';

export function localFileInfo(path: string, stats: LocalStats): TransferFileInfo {
  return {
    path,
    kind: fileKind(stats.mode),
    size: stats.size,
    modified: stats.mtimeMs,
    permissions: (stats.mode & 0o7777).toString(8).padStart(4, '0'),
    version: `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeMs}:${stats.mode}:${stats.uid}:${stats.gid}`,
  };
}
export function remoteFileInfo(path: string, stats: RemoteStats): TransferFileInfo {
  return {
    path,
    kind: fileKind(stats.mode),
    size: stats.size,
    modified: stats.mtime * 1000,
    permissions: (stats.mode & 0o7777).toString(8).padStart(4, '0'),
    version: `${stats.size}:${stats.mtime}:${stats.mode}:${stats.uid}:${stats.gid}`,
  };
}
export function sameFileInfo(a: TransferFileInfo, b: TransferFileInfo): boolean {
  return a.path === b.path && a.version === b.version;
}
export class TransferConflict extends FileBrowserError {
  constructor(
    readonly preview: TransferConflictPreview,
    readonly partialPath: string | null = null,
    readonly backupPath: string | null = null,
  ) {
    super('exists');
  }
}
export function conflictPreview(
  source: TransferFileInfo,
  destination: TransferFileInfo,
): TransferConflictPreview {
  return {
    token: randomUUID(),
    source,
    destination,
    replaceable:
      source.kind === 'file' &&
      destination.kind === 'file' &&
      [source, destination].every(
        (info) =>
          Number.isSafeInteger(info.size) && info.size >= 0 && Number.isFinite(info.modified),
      ),
  };
}
