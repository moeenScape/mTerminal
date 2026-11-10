# Command history and autocomplete

## Using it

Open a local terminal and click the **Terminal tools** icon (panel icon, top right of the
terminal), or choose **Command history** / **Terminal appearance…** from the terminal's ⋯ menu.
The panel includes:

- **Autocomplete** (rocket): turn suggestions on or off, turn saving of new commands on or off,
  see the shortcuts, and clear saved history.
- **History** (clock): every command, newest first. The search box matches anywhere in a
  command, ignoring case. Click a command to type it at the prompt without running it.
  Right-click a row, press the Menu key or Shift+F10, or use its ⋯ button for **Insert**,
  **Copy** and **Delete…**.
- **Snippets**: create and manage saved commands, insert them, or review an explicit Run action.
- **Themes** (palette): terminal theme, font, size, zoom and cursor for this tab.

Type the start of a command at a Bash prompt and a list of matching commands appears beneath the
cursor. The typed part is highlighted. **Up/Down** chooses a row, **Right Arrow** or a click
inserts it, **Enter** runs a chosen history row or inserts a chosen **Snippet** row for review,
and **Escape** hides the list. With no row chosen,
**Enter** runs what you typed; **Tab** always keeps its normal shell meaning.

Autocomplete is on by default. Saving new commands is off until enabled explicitly. Both settings
are saved with your preferences and can also be changed in **Settings**. An existing explicit
recording preference is preserved.

## Where commands come from

1. **Saved history.** New commands run in local Bash tabs, stored encrypted in the vault
   (`vault/history.enc`) with the folder they ran in. Among history results they are ranked
   ahead of native Bash entries, current folder first. This needs a set-up, unlocked vault;
   while it is locked, new commands are simply not saved. At most 500 entries and 512 KiB are kept, for 30 days.
2. **Your Bash history file.** `$HISTFILE`, or `~/.bash_history`, is read so the panel and
   suggestions are useful immediately. Only the last 1 MiB is read, duplicates are removed, and
   the file is re-read only when it changes. mTerminal never writes to this file; its entries can
   be copied or inserted but not deleted from the app.

Timestamp-delimited multiline Bash entries remain a single history item and are excluded from
autocomplete and insertion; they can be copied. Text before the first timestamp is omitted because
it may be an incomplete entry from the bounded read. Untimestamped files are assumed to use Bash's
usual one-command-per-line format; multiline boundaries cannot be recovered reliably there.
An unreadable Bash history file does not prevent access to saved vault history.

Commands that start with a space, contain control characters, or look like they carry a password,
token, secret or API key are never saved or suggested. That check cannot catch every secret.
Saved history is excluded from workspace backups and diagnostics.

## Saved snippet suggestions (F47.1)

Eligible single-line snippet commands from the unlocked vault also match the literal command
prefix. Curated snippets appear before history, sorted by folder/name, with a **Snippet** badge;
exact duplicate commands appear once. Names/folders are available in the tooltip and accessible
label. Selection always inserts without Enter after rechecking the saved content; it never
runs a snippet automatically. The combined list remains capped at 20 entries. Multiline,
control-bearing and secret-like commands are excluded. Path/argument sources are still pending.
See [autocomplete sources](AUTOCOMPLETE.md) for lifecycle and insertion details.

## Supported shells

Suggestions need local Bash 5.1+ with `base64` and `tr`. Every new local Bash tab gets a small prompt hook
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
