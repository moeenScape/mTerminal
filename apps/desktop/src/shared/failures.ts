export const failureMessages = {
  'broadcast-failed':
    'Broadcast could not start or send input. Check the recipients and select them again; input is never replayed automatically.',
  'batch-failed':
    'Command batch could not be started or updated. Refresh destinations and review the command again. Nothing is retried automatically.',
  'startup-limit':
    'Startup assignment storage is full. Remove unused assignments before adding more (500 targets).',
  'snippet-limit':
    'Snippet storage is full. Delete unused snippets before saving more (200 snippets or 512 KiB).',
  'snippet-conflict':
    'A snippet with this name already exists in this folder. Choose another name or edit the existing snippet.',
  'snippet-missing': 'The snippet no longer exists. Reload the snippet list before editing again.',
  'snippet-failed': 'Snippet operation failed. Check its fields and the local vault, then retry.',
  'vault-unavailable':
    'Secure credential storage is unavailable. Check that your operating system keychain is unlocked and supported; secrets were not saved.',
  'vault-corrupt':
    'A saved credential could not be read. Preserve the mTerminal data directory and check secure storage before replacing it.',
  'vault-secret-missing':
    'The saved credential is missing. Enter the password again or import the private key for this identity.',
  'vault-locked': 'The local vault is locked. Unlock it to use saved credentials.',
  'vault-passphrase-wrong': 'Vault passphrase was incorrect. No saved credentials were changed.',
  'vault-passphrase-weak': 'Choose a vault passphrase between 12 and 256 characters.',
  'ssh-key-invalid':
    'The private key could not be imported. Check its format and passphrase, then try again.',
  'ssh-host-unverified':
    'Connect to this host and verify its server identity before installing a key.',
  'ssh-key-install-failed':
    'The public key could not be installed. Check the remote account and its SFTP permissions, then retry.',
  'ssh-cancelled': 'SSH connection cancelled.',
  'ssh-keepalive-timeout':
    'SSH server stopped responding to keepalive probes. The connection was closed. Reconnect to start a new shell; previous commands will not be replayed.',
  'ssh-auth-failed': 'The server rejected the username or password. Check them and try again.',
  'ssh-failed':
    'SSH connection failed. Check the address, port, username, password and server availability, then retry.',
  'ssh-key-mismatch':
    'Server identity was not accepted or changed. Connection refused. Verify the fingerprint through a trusted channel; after replacing a saved key, start a new connection.',
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
