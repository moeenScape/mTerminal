export const failureMessages = {
  'ssh-failed':
    'SSH connection failed. Check the address, port, username, password and server availability, then retry.',
  'ssh-key-mismatch':
    'The server key does not match the supplied fingerprint. Connection refused. Verify the fingerprint through a trusted channel before retrying.',
  'clipboard-unavailable': 'Clipboard access failed. Focus mTerminal and try Copy or Paste again.',
  'clipboard-too-large':
    'Clipboard text exceeds the limit. Copy a smaller selection (up to 1 Mi characters) and try again.',
  'terminal-limit':
    'The maximum of 16 local terminals is open. Close an existing terminal tab before creating another.',
  'shell-invalid':
    'The selected default shell is unavailable. In Settings, enter an absolute path to an existing executable without arguments or surrounding quotes, or clear the field to use the platform default. On Windows, use an .exe or .com file.',
  'shell-missing':
    'No usable shell was found. Install Bash or Zsh on Linux/macOS, or PowerShell on Windows, then retry. You can also set an absolute shell executable path in Settings.',
  'terminal-failed':
    'The local shell could not start or stopped unexpectedly. Check the default shell executable in Settings and rebuild native modules with npm run rebuild:native if needed.',
  'terminal-overflow':
    'The terminal produced more output than could be buffered safely. The session was stopped. Start a new shell; command execution is never replayed automatically.',
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
