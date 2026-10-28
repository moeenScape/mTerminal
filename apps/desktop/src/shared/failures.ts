export const failureMessages = {
  'database-locked':
    'The local database is in use or a lock remains after a crash. Close other mTerminal and maintenance processes. If none are running, follow docs/LOCAL_STORAGE.md to inspect the lock before removing it.',
  'database-invalid':
    'The local database is damaged or uses an unsupported schema. Preserve the database and its journals. Use a matching application version or restore a validated backup using docs/LOCAL_STORAGE.md.',
  'database-open':
    'The local database could not open. Check the data directory permissions and available disk space. Preserve existing files before attempting recovery.',
  'preferences-invalid':
    'Saved preferences could not load. Quit mTerminal, back up preferences.json, then repair it or move it aside to use defaults. The database is separate.',
  'preferences-save':
    'Preferences could not be saved. Your changes are still in this form. Check data directory permissions and disk space, then try Save again.',
  'permission-denied':
    'Access to local application files was denied. Check the data directory permissions and retry. Do not delete existing data.',
  'disk-full':
    'The disk is full. Free some space and retry. Existing data files have been preserved.',
  'backup-unsupported':
    'A database backup could not be published. Use a local filesystem that supports hard links, such as ext4, APFS, or NTFS. Preserve the existing database.',
  'renderer-load':
    'The application interface could not load. Restart mTerminal. If this repeats, rebuild or reinstall the application while preserving the data directory.',
  'renderer-crashed':
    'The application interface stopped unexpectedly. Restart mTerminal. Local data files have been retained.',
  unexpected:
    'An unexpected application error occurred. Restart mTerminal. Preserve local files and include the diagnostic event code when reporting the problem.',
} as const;
export type FailureCode = keyof typeof failureMessages;
export type PreferenceSaveResult =
  | { ok: true; preferences: import('./preferences.js').Preferences }
  | { ok: false; code: FailureCode };
