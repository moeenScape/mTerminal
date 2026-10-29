# Command history and suggestions

## Enable recording

1. Set up and unlock the local vault.
2. In a local terminal, click **History** to open the right sidebar. Click **Enable recording**
   in the empty state, or expand **Recording & privacy** and enable **Record local Bash commands**.
3. Open a **New terminal** using Bash 5 or newer. Set **Settings → Default shell executable**
   to `/bin/bash` if needed. Existing shells are not changed.
4. Run a command, then type its beginning at the next prompt. A dropdown beneath the cursor
   lists up to five previously recorded commands and highlights the prefix. **Up/Down** selects
   a row; **Right Arrow** or clicking a row inserts its suffix; **Escape** dismisses the list.
   Press **Enter** separately to execute. Tab remains the shell's completion key.

Recording is disabled by default and resets when the application window closes. Unchecking
the recording option pauses capture in existing integrated sessions too. The option requires
an unlocked vault. Saving stops while the vault is locked. Suggestions require an integrated
local Bash prompt and are suppressed after command submission, in applications and password
prompts, in alternate-screen programs, and while editing inside a command.

The top of the History panel reports whether recording is active in the current tab, not
attached, or unavailable for its shell. Saved commands refresh the list and suggestions
automatically. A newly enabled setting does not attach recording to an already running shell.

## Find and manage commands

The right sidebar has History and Autocomplete tabs. History searches by prefix and lists up
to 20 results. Commands from the current
directory rank first, followed by recent commands. Repeated command/directory pairs share an
entry with a usage count. Clicking a command requires an empty integrated prompt and inserts
single-line text without executing it. Hover or focus a row to reveal Copy and Delete actions;
multiline commands can be copied. **Clear history** is under Recording & privacy. Deletion
requires confirmation. The Autocomplete tab enables or disables the dropdown for the current
tab and lists its shortcuts. The sidebar preserves the terminal's full height; the popup moves
above the cursor when there is insufficient space below.

Only commands recorded by mTerminal are offered. Existing native Bash history is not imported.

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
