# Command history and autocomplete

## Using it

Open a local terminal and click the **Terminal tools** icon (panel icon, top right of the
terminal), or choose **Command history** / **Terminal appearance…** from the terminal's ⋯ menu.
The panel has three tabs, as in Termius:

- **Autocomplete** (rocket): turn suggestions on or off, turn saving of new commands on or off,
  see the shortcuts, and clear saved history.
- **History** (clock): every command, newest first. The search box matches anywhere in a
  command, ignoring case. Click a command to type it at the prompt without running it.
  Right-click a row, press the Menu key or Shift+F10, or use its ⋯ button for **Insert**,
  **Copy** and **Delete…**.
- **Themes** (palette): terminal theme, font, size, zoom and cursor for this tab.

Type the start of a command at a Bash prompt and a list of matching commands appears beneath the
cursor. The typed part is highlighted. **Up/Down** chooses a row, **Right Arrow** or a click
inserts it, **Enter** runs the chosen command, and **Escape** hides the list. With no row chosen,
**Enter** runs what you typed; **Tab** always keeps its normal shell meaning.

Both settings are on by default and saved with your preferences. They can also be changed in
**Settings**.

## Where commands come from

1. **Saved history.** New commands run in local Bash tabs, stored encrypted in the vault
   (`vault/history.enc`) with the folder they ran in. They are ranked first, current folder
   first. This needs a set-up, unlocked vault; while it is locked, new commands are simply not
   saved. At most 500 entries and 512 KiB are kept, for 30 days.
2. **Your Bash history file.** `$HISTFILE`, or `~/.bash_history`, is read so the panel and
   suggestions are useful immediately. Only the last 1 MiB is read, duplicates are removed, and
   the file is re-read only when it changes. mTerminal never writes to this file; its entries can
   be copied or inserted but not deleted from the app.

Commands that start with a space, contain control characters, or look like they carry a password,
token, secret or API key are never saved or suggested. That check cannot catch every secret.
Saved history is excluded from workspace backups and diagnostics.

## Supported shells

Suggestions need local Bash 5+ with `base64`. Every new local Bash tab gets a small prompt hook
from a temporary rc file that sources your `~/.bashrc`; your dotfiles are not modified. Zsh,
PowerShell and SSH sessions get the History and Themes tabs (inserting a command types it into
the session) but no inline suggestions yet.

## Implementation

The prompt hook reports the prompt position and each finished command through bounded,
session-token-tagged OSC 777 messages. The main process strips recording messages before output
reaches xterm.js. No keystroke logging or output scraping is used to collect commands.
Suggestions read only the current prompt from the terminal buffer, and accepting one requires the
typed prefix to still match. Only the main process reads the history files; the renderer receives
search results (up to 20 for suggestions, 200 for the panel).
