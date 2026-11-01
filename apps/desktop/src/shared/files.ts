export const FILES_LIST = 'files:list';
export const FILE_LIST_LIMIT = 5000;
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
}
export type FileListRequest =
  { side: 'local'; path: string } | { side: 'remote'; path: string; sessionId: string };
export const fileErrorMessages = {
  permission: 'Permission denied. Choose a folder your account can read.',
  missing: 'This path no longer exists. Refresh or choose another folder.',
  directory: 'This path is not a directory.',
  disconnected: 'The SSH session is disconnected. Reconnect the terminal and retry.',
  busy: 'A directory request is already running. Try again shortly.',
  unavailable:
    'Unable to read this folder. Check the connection and SFTP availability, then retry.',
} as const;
export type FileErrorCode = keyof typeof fileErrorMessages;
export type FileListResult =
  { ok: true; value: DirectoryListing } | { ok: false; code: FileErrorCode };
export interface FilesApi {
  listDirectory: (request: FileListRequest) => Promise<DirectoryListing>;
}
