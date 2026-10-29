# Command history and suggestions

## Enable recording

1. Set up and unlock the local vault.
2. In a local terminal, click **History** and enable **Record commands in new Bash sessions**.
3. Open a **New terminal** using Bash 5 or newer. Set **Settings → Default shell executable**
   to `/bin/bash` if needed. Existing shells are not changed.
4. Run a command, then type its beginning at the next prompt. A faint suffix suggests a
   previously recorded command. **Right Arrow** inserts the suffix; **Escape** dismisses it.
   Press **Enter** separately to execute. Tab remains the shell's completion key.

Recording is disabled by default and resets when the application window closes. Unchecking
the recording option pauses capture in existing integrated sessions too. The option requires
an unlocked vault. Saving stops while the vault is locked. Suggestions require an integrated
local Bash prompt and are suppressed after command submission, in applications and password
prompts, in alternate-screen programs, and while editing inside a command.

## Find and manage commands

The History panel searches by prefix and lists up to 20 results. Commands from the current
directory rank first, followed by recent commands. Repeated command/directory pairs share an
entry with a usage count. **Insert** requires an empty integrated prompt and inserts single-line
text without executing it. Multiline commands can be copied. Delete individual entries or use
**Clear all history**; both operations ask for confirmation.

## Storage and privacy

mTerminal's history is encrypted with the vault key and OS secure storage in `vault/history.enc`.
It is excluded from workspace JSON backups and diagnostics. At most 500 entries and 512 KiB of
history JSON are retained. Entries older than 30 days are removed on the next history access.
Vault reset preserves this file with the other encrypted vault files under `vault/recovery-*`.

Commands can contain credentials. Recording is opt-in; simple password/token filters cannot
identify every secret. A leading space excludes a command in integrated sessions. Bash's own
history settings and exclusions still apply, so usage counts are not an audit trail. This
feature does not encrypt or manage Bash's separate native history file. Commands are recorded
when Bash returns to its next prompt; commands such as `exit` or `exec` that do not return
are not captured.

## Supported shells and implementation

This first version supports new local Bash 5+ sessions with the `base64` utility available.
Zsh, PowerShell, and SSH capture are not implemented. Unsupported shells keep normal terminal
behavior without suggestions. Existing shell configuration is sourced from a temporary rc file;
user dotfiles are not modified. Temporary integration files are removed on shell shutdown.

A prompt hook reports actual shell-history commands through bounded, session-token-tagged OSC
messages. The main process consumes recording messages before forwarding output to xterm.js.
No keystroke logger or terminal-output scraping is used to collect commands. Suggestions read
only the current prompt buffer, and acceptance requires a matching prefix at the cursor end.
Only the main process reads or writes the encrypted history file. The renderer receives limited
search results while the vault is unlocked.
