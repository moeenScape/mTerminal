import { validFileName, type FileEntry } from '../../../../shared/files.js';
import type { TransferRequest } from '../../../../shared/transfers.js';

export const FILE_DRAG_TYPE = 'application/x-mterminal-file';
export interface FileDrag {
  token: string;
  side: 'local' | 'remote';
  entry: FileEntry;
  directory: string;
  sessionId: string;
}
export function fileDropRequest(
  drag: FileDrag | null,
  target: 'local' | 'remote',
  context: Omit<TransferRequest, 'direction' | 'name'> | null,
): TransferRequest | null {
  if (
    !drag ||
    !context ||
    drag.side === target ||
    drag.entry.kind !== 'file' ||
    !validFileName(drag.entry.name) ||
    drag.sessionId !== context.sessionId ||
    drag.directory !== (drag.side === 'local' ? context.localDirectory : context.remoteDirectory)
  )
    return null;
  return {
    ...context,
    name: drag.entry.name,
    direction: drag.side === 'local' ? 'upload' : 'download',
  };
}

export type FileSort = 'name' | 'size' | 'modified' | 'kind';
export function visibleFiles(
  entries: FileEntry[],
  hidden: boolean,
  sort: FileSort,
  descending: boolean,
  query = '',
) {
  return entries
    .filter(
      (entry) =>
        (hidden || !entry.name.startsWith('.')) &&
        entry.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    )
    .sort((a, b) => {
      const folders = Number(b.kind === 'directory') - Number(a.kind === 'directory');
      const comparison =
        sort === 'name'
          ? a.name.localeCompare(b.name, undefined, { numeric: true })
          : sort === 'kind'
            ? fileKindLabel(a).localeCompare(fileKindLabel(b))
            : sort === 'size'
              ? a.size - b.size
              : a.modified - b.modified;
      return folders || (descending ? -1 : 1) * comparison || a.name.localeCompare(b.name);
    });
}
export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
}

export interface DirectoryHistory {
  paths: string[];
  index: number;
}
export function rememberDirectory(
  history: DirectoryHistory,
  path: string,
  index: number | null = null,
): DirectoryHistory {
  if (index !== null && history.paths[index] === path) return { ...history, index };
  if (history.paths[history.index] === path) return history;
  const paths = [...history.paths.slice(0, history.index + 1), path].slice(-64);
  return { paths, index: paths.length - 1 };
}
export function fileKindLabel(entry: Pick<FileEntry, 'kind' | 'name'>): string {
  if (entry.kind === 'directory') return 'Folder';
  if (entry.kind === 'symlink') return 'Link';
  if (entry.kind === 'other') return 'Special';
  const dot = entry.name.lastIndexOf('.');
  const extension = dot > 0 ? entry.name.slice(dot + 1) : '';
  return extension && extension.length <= 8 ? `${extension.toUpperCase()} file` : 'File';
}
export function symbolicPermissions(value: string, kind: FileEntry['kind']): string {
  if (!/^[0-7]{3,4}$/.test(value)) return value;
  const mode = Number.parseInt(value, 8);
  const rights = [8, 7, 6, 5, 4, 3, 2, 1, 0].map((bit, index) =>
    mode & (1 << bit) ? 'rwx'[index % 3]! : '-',
  );
  for (const [bit, index, letter] of [
    [0o4000, 2, 's'],
    [0o2000, 5, 's'],
    [0o1000, 8, 't'],
  ] as const)
    if (mode & bit) rights[index] = rights[index] === 'x' ? letter : letter.toUpperCase();
  return (
    (kind === 'directory' ? 'd' : kind === 'symlink' ? 'l' : kind === 'file' ? '-' : '?') +
    rights.join('')
  );
}
