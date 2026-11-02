export const FILES_LIST = 'files:list';
export const FILES_MUTATE = 'files:mutate';
export const FILE_LIST_LIMIT = 5000;
export function validFileName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    !!name.trim() &&
    name !== '.' &&
    name !== '..' &&
    name.length <= 255 &&
    !/[\\/]/.test(name) &&
    !Array.from(name).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  );
}
export interface FileEntry {
  name: string;
  path: string;
  kind: 'directory' | 'file' | 'symlink' | 'other';
  size: number;
  modified: number;
  permissions: string;
}
export interface DirectoryListing {
  path: string;
  parent: string;
  breadcrumbs: { name: string; path: string }[];
  entries: FileEntry[];
  truncated: boolean;
  canChmod: boolean;
}
export type FileOperation =
  | { action: 'mkdir'; name: string }
  | { action: 'rename'; name: string; newName: string }
  | { action: 'delete'; name: string }
  | { action: 'chmod'; name: string; mode: string };
export type FileMutationRequest = FileListRequest & { operation: FileOperation };
export type FileListRequest =
  { side: 'local'; path: string } | { side: 'remote'; path: string; sessionId: string };
export const fileErrorMessages = {
  permission: 'Permission denied. Your account cannot perform this operation.',
  missing: 'This path no longer exists. Refresh or choose another folder.',
  directory: 'This path is not a directory.',
  disconnected: 'The SSH session is disconnected. Reconnect the terminal and retry.',
  busy: 'A file operation is already running. Try again shortly.',
  exists: 'The destination already exists. Choose another name; existing items are preserved.',
  'not-empty': 'This folder is not empty. Only empty folders can be deleted.',
  unsupported: 'This operation is unavailable for this item or platform.',
  cancelled: 'Transfer cancelled.',
  'editor-busy': 'Finish the current remote editing session before starting another.',
  'editor-text-only':
    'Remote editing supports regular UTF-8 text files up to 1 MiB, without binary control characters.',
  'editor-launch-failed':
    'The text editor could not be opened. Set a default application for .txt files, then choose Open editor again.',
  'editor-copy-unavailable':
    'The working copy is missing, changing, or unreadable. Save it in the editor and retry.',
  'editor-unchanged': 'There are no saved changes to upload.',
  'queue-full': 'The transfer queue is full. Clear finished transfers before adding more.',
  'source-changed':
    'The source file changed or ended early. It was not published at the destination.',
  'destination-changed':
    'The destination changed after preview. Inspect the folder and any reported backup, then start a new transfer.',
  'transfer-timeout':
    'The transfer stopped responding. Inspect the destination before trying again.',
  'transfer-failed':
    'The transfer failed. Check the source, destination, connection and available disk space.',
  uncertain:
    'The operation may have completed before the connection failed. Refresh and inspect the paths before trying again.',
  partial:
    'The new name was created, but the old name could not be removed. Inspect both names before trying again.',
  unavailable:
    'Unable to complete the file operation. Check permissions and SFTP availability. Folders must be empty for deletion.',
} as const;
export type FileErrorCode = keyof typeof fileErrorMessages;
export type FileListResult =
  { ok: true; value: DirectoryListing } | { ok: false; code: FileErrorCode };
export type FileMutationResult = { ok: true } | { ok: false; code: FileErrorCode };
export interface FilesApi {
  listDirectory: (request: FileListRequest) => Promise<DirectoryListing>;
  mutateDirectory: (request: FileMutationRequest) => Promise<void>;
}
