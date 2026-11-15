# Session logs (F48)

## Record and read

1. Set up/unlock the vault in **Settings**. A supported OS secure-storage backend is required.
2. Open a local or SSH terminal and wait until it is running/connected.
3. Choose **Logs** in the session strip, select the terminal, then **Review recording**.
4. Read the sensitive-output warning and choose **Start recording**. The strip shows **Recording**.
5. Closing the panel keeps recording. Reopen it and choose **Stop recording**, then select a saved row to read it.

Recording captures new output batches after approval; existing scrollback is excluded. It
works independently of Bash command history and autocomplete. Only one recording runs per
window. Starting another requires stopping the current one. Terminal disconnect, reload,
renderer failure, vault lock/reset, window close, and the character limit stop capture.
Recordings never resume automatically.

## Notes, bookmarks and deletion

Stop a recording before editing its annotations. Select a saved log, enter **Log notes**, or
choose a **Bookmark line** and optional **Bookmark comment**, then **Add bookmark**. Choose
**Save annotations** to persist changes. Clicking a bookmark highlights its line. Switching
logs or closing the panel discards unsaved annotations.

**Delete** requires confirmation and removes that log's output, notes and bookmarks from the
current collection. It does not remove copies in separate backups or vault recovery folders.

## Privacy and storage

Output can contain passwords, tokens, private files and echoed commands. There is **no automatic
secret redaction**. Recording does not attach to input or authentication callbacks; anything a
program echoes can still be captured. Only record sessions whose output you intend to retain.

The main process strips ANSI/OSC/DCS control sequences and writes a plain-text transcript,
not a terminal screen replay. Progress rewrites, cursor movement, backspaces and full-screen
applications will not reproduce their final screen. The viewer renders inert text; terminal
protocols and links are not executed. Current active text requires selecting the saved row
again after a checkpoint to refresh it.

`userData/vault/session-logs.enc` uses the existing passphrase-protected vault encryption and
OS secure storage. No plaintext recording file or export is created. Reading, starting,
annotating and deleting require an unlocked vault. Locking also closes the log viewer.
Vault reset archives this file with the existing encrypted vault in `vault/recovery-*`.
It does not decrypt or recover forgotten credentials or logs.

## Bounds, retention and interrupted writes

- Four logs maximum; delete one before creating a fifth. No automatic quota eviction.
- 32,768 UTF-16 code units per log; capture stops when the limit is reached.
- Twenty bookmarks per log, 256 characters per comment, and 512 characters of notes.
- The encrypted collection's JSON plaintext is limited to 512 KiB, including metadata.
- Logs expire 30 days after creation. Pruning happens on unlocked collection access/save,
  not on a background schedule. Files may remain on disk while the app/vault is unused.
- Changed output is checkpointed every two seconds, plus a final write on normal stop.
  A crash retains the last successful checkpoint, with a possible unsaved tail. Inactive
  checkpoint rows are labeled **Interrupted checkpoint** and cannot resume recording.
- Storage failures stop capture and keep the previous successfully written ciphertext.
  There is no plaintext fallback or automatic retry of a failed recording.

Retention/deletion replaces the active collection; neither guarantees physical secure erasure
or deletion of independent backups. Record only what is appropriate to keep under these bounds.

## Validation status

Regression tests cover stream filtering, recorder lifecycle/quotas, IPC ownership and payloads,
encrypted persistence, failed writes, annotations, retention, reset, and the desktop workflow.
Tests are written but intentionally unrun. Live local/SSH capture, secure-storage behavior,
visual/accessibility and macOS/Windows acceptance still need verification.
