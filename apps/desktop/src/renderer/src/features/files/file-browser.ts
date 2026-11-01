import type { FileEntry } from '../../../../shared/files.js';

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
