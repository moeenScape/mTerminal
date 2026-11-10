# Snippets

Open **Terminal tools → Snippets**, or choose **Snippets** from a terminal's More actions
menu. The snippets library is shared across local and SSH panes on this device.

## Save and organize

Set up or unlock the local vault when prompted. Click **New snippet**, enter a name and
command, and optionally specify a folder such as `Work/Production` and comma-separated tags.
Click **Save snippet**. Edit moves a snippet between folders as well as changing its content;
its ID is retained. Names must be unique within a folder. Deletion requires confirmation.

Search matches words across names, commands, folders and tags without case sensitivity.
Selecting a folder also includes its descendants. Reload refreshes the list after an error;
changes made in another pane refresh open snippet panels automatically.

Commands retain indentation and normalize CR/CRLF endings to LF. Limits are 200 snippets,
512 KiB of plaintext collection data, 80-character names, 4,096-character commands and ten
32-character tags. Folder paths follow the existing nested-group path limits. Control
sequences, escape bytes and ambiguous Unicode line separators are rejected.

## Insert or run

- **Insert** sends a single-line snippet without Enter. Check the command, then press Enter
  yourself. Multiline snippets cannot use Insert.
- **Run…** displays the complete command and the target pane's title. **Cancel** sends nothing;
  **Run snippet** pastes the reviewed text and submits Enter to that captured session only.

The target must remain running, selected and visible. Closing, reconnecting or disconnecting
it invalidates a pending run; it is never redirected to another session. Vault lock cancels
pending previews. Local Bash integration requires an empty recognized prompt. For SSH and
unsupported shells, ensure the terminal is at an empty shell prompt: the application cannot
determine whether another program or a password prompt will receive the input.

A snippet uses the current shell environment and working directory. Saving, opening a tools
panel, loading a workspace template or reconnecting never runs a snippet automatically.
Startup assignments are described below. F47.1 adds eligible single-line commands to local Bash
autocomplete, marked **Snippet**. Selection inserts without Enter and revalidates the saved
content and vault access. Multiline/control-bearing or secret-like commands stay out of this
source. See [autocomplete sources](AUTOCOMPLETE.md).

## Startup assignments

In Terminal tools → Snippets, select a **Startup snippet for local terminals** or **this SSH
host**, then click **Save startup assignment**. Select **None** to remove it. Local terminals
share one assignment; each saved SSH host has its own. These changes apply to new connections,
including explicitly started template panes and split sessions. Existing sessions are unaffected.

After a connection opens successfully, its pane offers **Review startup** and **Skip startup**.
Review fetches the current assignment and shows the full command in the existing confirmation
dialog. No startup command is sent automatically. Check that the terminal is at an empty prompt,
then choose Run snippet. A changed assignment/command is rejected at confirmation.

Skip or Cancel dismisses the startup action for that connection. Once a submission is attempted,
it cannot be repeated through the startup notice, even if the send fails partway through. The
notice reports an attempt, not command completion or exit status. Watch the terminal output.
A deliberate reconnect creates a new connection with a fresh review offer; focus changes and
network failures never replay commands. Manual Run from the snippets library remains available.

Vault lock clears pending commands. After unlocking, **Check startup snippets** can retry a failed
lookup, but cannot repeat a consumed action. Late lookup results after disconnect/close are
ignored. Startup snippets are not run while a template is merely opened or a connection is
still authenticating. SSH/unsupported shells cannot detect prompt readiness automatically.

Assignments are encrypted in `snippets.enc`, not stored in host metadata or exports. Old
version-1 snippet files without assignments remain readable. There are at most 500 targets,
within the existing collection byte limit. Editing a snippet preserves its assignments; deleting
it removes those references in the same atomic write. Deleted host IDs never transfer their
assignment to a newly created host, and cannot receive new non-empty assignments.

## Storage and verification

The vault stores version-1 snippet records in `snippets.enc`, protected by its passphrase and
the OS keychain. Locked or unavailable storage blocks reads and writes, with no plaintext
fallback. Writes are serialized and atomically replace ciphertext; quota, read and encryption
failures preserve the previous file. Snippets persist until explicitly deleted or the vault
is reset. Reset moves their ciphertext into the existing recovery folder.

Avoid hard-coded credentials: use variables or managed identities. Commands are decrypted in
the renderer only for the snippet interface, eligible autocomplete suggestions and execution. They are excluded from workspace
JSON exports, SQLite snapshots and diagnostics. Back up the encrypted vault files together
with the rest of the app data and retain the vault passphrase and required OS keychain.

Unit and desktop regression code is written but remains unrun at the user's request. Real
keychain persistence, visual/accessibility behavior, live SSH and cross-platform acceptance
remain pending.
