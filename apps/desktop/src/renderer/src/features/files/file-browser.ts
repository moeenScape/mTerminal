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

export type FileSort = 'name' | 'size' | 'modified';
export function visibleFiles(
  entries: FileEntry[],
  hidden: boolean,
  sort: FileSort,
  descending: boolean,
) {
  return entries
    .filter((entry) => hidden || !entry.name.startsWith('.'))
    .sort((a, b) => {
      const folders = Number(b.kind === 'directory') - Number(a.kind === 'directory');
      const comparison =
        sort === 'name'
          ? a.name.localeCompare(b.name, undefined, { numeric: true })
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
