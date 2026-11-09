# Local and SFTP file browser

## Open Files

1. Open a terminal tab in **Workspace**.
2. Click the folder icon labelled **Files**, or choose **Browse files** from the terminal menu.
3. The left pane browses the local computer, starting at your home directory.
4. For remote files, connect to a saved SSH host through **Hosts**, then open **Files** in that
   SSH tab. The right pane starts at the remote account's home directory.
5. **Back to terminal** returns to the same shell without disconnecting it.

The remote pane reuses the tab's authenticated, fingerprint-verified SSH connection. Password,
saved identity, vault, keyboard-interactive authentication, and changed-host-key checks follow
the existing SSH workflow. Closing the tab or disconnecting SSH ends its SFTP requests. After
reconnecting the terminal, the remote browser retries its last folder. Changes from dialogs opened
on an older SSH connection are refused; close and reopen the action after reconnecting.
Servers must allow both a shell and the SFTP subsystem for this first implementation.

## Navigate, select and filter

- Each pane has a compact heading with **Filter**, selected-file **Upload… / Download…**, and
  **Actions**. Controls use the application theme; Local and Remote retain distinct badges.
- **Single-click** a row to select it. **Double-click** a folder/link, press **Enter** on its row,
  or choose **Actions → Open folder** to browse. Arrow keys, Home and End move row selection;
  Shift+F10 opens its file menu. Selection is scoped to the shown folder and connection, and
  filtered-out, disconnected or stale entries cannot drive selected-file actions.
- Use **Back / Forward** for successful navigation history (up to 64 entries), **Up** for the
  parent, or click a breadcrumb. Failed reads do not advance history. A new route after Back
  replaces forward history; refreshes do not create duplicate entries.
- The pencil button opens an editable absolute path. Enter it and choose **Go**; Escape or its
  close button cancels editing. The path editor closes after navigation and background refresh
  does not overwrite an unfinished path. **Actions → Home** returns to the initial account home.
- **Refresh / Retry** rereads the current/requested folder. On failure the previous folder stays
  visible with an error and stale-selection actions disabled.
- **Filter** searches loaded filenames without case sensitivity, separately in each pane. Its
  close button clears the query. It does not search subdirectories or unloaded entries.
  **Actions → Show hidden files / Hide hidden files** controls dot-prefixed names.
- Click **Name / Date Modified / Size / Kind** to sort; clicking again reverses direction.
  Folders stay first. Kind describes the entry type or filename extension, not inspected MIME data.
- Permissions appear below filenames in symbolic form, including setuid/setgid/sticky bits;
  the tooltip retains the octal mode. Times use the computer's locale/timezone. Windows reports
  Node's mode, not a Windows ACL. Symbolic links and special files remain identifiable.
- Panes stack in narrow windows; file tables scroll when needed. Regular files remain draggable
  in either direction. Dropping on a folder row still targets the opposite pane's open folder.

## Compact activity panels

Transfers keeps a small summary when idle and opens for running/conflict/failed/uncertain work.
Use its disclosure button to inspect finished history. Saved recovery records start collapsed
with a count; choose **Show recovery records** to inspect or resume/clean a specific item.
Remote editor is hidden when unused, compact when ready and unchanged, and opens for pending
saved changes, active work or errors. Its disclosure button shows retained-copy details.
Errors remain visible and all existing confirmation/overwrite/recovery safeguards still apply.

## Create, rename, delete, and change permissions

- **Actions → New folder** creates one folder in the pane's current directory.
- The pane's **Actions** menu uses its selected row. Each row's **⋯** and right-click menu also offer **Rename…**, **Permissions…**, and **Delete…**. Keyboard
  users can focus the Actions button and open it with Enter or Space.
- Names must be single path components: no slash, backslash, control characters, dot, or dot-dot.
  Rename stays in the same directory and refuses an existing destination, including an empty one.
- Confirmation shows the local/remote account scope and exact item path. Delete permanently
  removes one file, symbolic link, or empty folder. It does not use trash or recurse. Removing
  a link keeps its target; a nonempty folder is refused.
- Permissions accept three or four octal digits, such as `755` or `0644`. Changes apply only to
  that item. Symbolic links and special files are refused. Local Windows permission editing is
  disabled because numeric POSIX modes do not represent Windows ACLs.
- Every attempted change refreshes the affected folder and shows its outcome. If the SSH
  connection or response fails during a change, its outcome is uncertain: inspect the refreshed
  source and destination before trying again. Mutations are never retried automatically.

Local file/link rename uses hard-link creation followed by removal of the old name to avoid
overwriting a destination. If removing the old name fails, both names remain and the UI reports a
partial result. Filesystems without hard-link support refuse that rename. Directory rename
reserves an empty destination directory before replacing it; platforms that cannot replace this
reservation refuse the operation and attempt to remove the empty reservation. Case-only rename
on case-insensitive filesystems is not supported.

Local permission changes use a no-follow descriptor and require read access to the item. Remote
permissions use SFTP path operations after checking the item with `lstat`; concurrent changes by
other clients are governed by the server's filesystem semantics. The browser does not elevate
privileges. F36 provides [remote text editing](REMOTE_EDITING.md) through a private local working
copy, the system's default text editor, saved-change detection and explicit snapshot uploads.

## Uploads, downloads, and the transfer queue

1. Connect to a saved SSH host and open **Files** in that terminal tab.
2. Navigate both panes to the desired source/destination folders.
3. Select a regular file, then choose **Upload…** in the Local heading or **Download…** in the
   Remote heading. Row menus offer the same actions after both folders load.
4. Confirm the file name, SSH tab, direction, and both folders, then choose **Add to queue**.
5. The queue beneath the panes shows bytes transferred, progress and status. **Cancel** removes
   a queued job or interrupts an active copy; **cancelling** remains visible during cleanup.

You can also drag one regular file from **Local** to **Remote** to upload, or from **Remote**
to **Local** to download. Drop anywhere inside the opposite pane to target its **currently open
folder**; hovering over a folder row does not select that subfolder. The target highlights and
shows its path. Dropping opens the same confirmation dialog; choose **Add to queue** to start,
or **Cancel** to leave both computers unchanged.

The heading's visible **Upload…** / **Download…** button acts on the selected regular file.
Its row's **⋯** button or right-click menu offers the same action. The terminal toolbar's **⋯** menu contains Copy/Paste/
Close session; choose **Browse files** there, or the folder icon labelled **Files**, to reach this
view. Both folders must load successfully, and the SSH connection must be opened through Hosts.
Typing `ssh ...` inside a local shell does not attach the remote file pane.

Drag-and-drop currently supports individual regular files **between these two app panes**.
Folders, symlinks, multiple selections, OS file-manager drops and same-pane moves are unavailable.
Only a token bound to an actual row drag is accepted; dropped paths/URLs are never parsed as
transfer instructions. A changed connection/source folder or an unavailable target refuses the
drop. The main process still validates every queued request and uses the normal conflict,
backup, progress, cancellation and recovery behavior.

One transfer runs at a time per window, with up to 32 jobs including finished jobs. **Clear
finished** removes only queue records; it never deletes files. Existing destinations wait for an
explicit conflict decision. Directory, symbolic-link and special-file transfers are unavailable.
There is no automatic retry, reconnect, resume or recursive transfer.

Transfers continue while you return to the terminal or switch views. Closing the SSH tab,
disconnecting its session, reloading the renderer or closing the window cancels associated work.
Queued jobs stay bound to their original SSH session; reconnecting does not replay them. Queue
records live only in memory and disappear on restart; durable recovery evidence remains in the
separate SQLite journal. A job captures the folder paths at enqueue time; the filesystem and source contents are checked when it starts, not copied at enqueue time.

Copies use one 64 KiB buffer and a separate SFTP channel on the existing verified connection, so
folder listing remains available. File mutations through the browser are refused while a transfer
is active. Progress notifications are throttled to about five per second. Each SFTP request has
a 30-second deadline; cleanup requests have a separate five-second deadline. Cancellation of
local filesystem I/O waits for the OS operation to return.

New transfers copy into an exclusive `.mterminal-<uuid>.part` file in the destination folder, with
mode `0600` where supported. Byte counts and source size/mtime are checked before publication.
This detects common source changes but is not a checksum or an immutable source snapshot;
SFTP v3 modification times have second precision. Files that are being modified should be copied
after their writer stops. Source permissions and timestamps are not copied automatically.

New-file upload publishes with standard non-overwriting SFTP rename. Download syncs/closes the staged
file and publishes through exclusive hard-link creation, which requires a destination filesystem
with hard-link support. Originals are never removed. A destination created during copying is
also detected at publication and requires a conflict decision.

After settlement, the visible folders refresh. If a remote rename response is lost, the queue
shows **uncertain** because the complete final file may already exist. Failed cleanup reports
the possible temporary path, including an unacknowledged remote staging-file creation. Inspect
that path before removing it. Journaled pre-publication disconnects/timeouts and cancelled/failed
resumes retain the partial for explicit recovery. Crashes or forced shutdown can also leave
temporary files. Use **Inspect temporary file…** or **Resume…** in saved recovery records;
[Transfer recovery](TRANSFER_RECOVERY.md) describes verification, confirmation and refusal rules.

## Existing destinations: Replace, Skip, or Cancel

An existing destination changes the job to **conflict**. Other queued jobs can continue; a waiting
conflict does not hold an SFTP channel open. Choose **Resolve…** to review the SSH tab/direction,
exact canonical source/destination paths, file types, byte sizes, modification times, and modes.

- **Skip** is focused by default; Enter skips this job without changing the destination.
- **Replace** is available only for regular-file destinations with usable metadata. It copies
  the entire source to a staging file before touching the old destination.
- **Cancel transfer**, including Escape in the conflict dialog, cancels this job.

Decisions contain only the job ID, preview token, and choice. The main process retains the
approved paths and metadata. A stale token is refused. Source and destination snapshots are
rechecked at the start, and the destination again just before publication. A changed existing
item produces a new preview; a vanished destination invalidates replacement approval. Directory,
symbolic-link and special-file destinations cannot be replaced.

Replacement moves the old destination to an exclusive `.mterminal-<uuid>.bak` path in the same
folder. The captured item's metadata is checked again before the new file is published without
overwriting any newly created destination. Local replacement verifies hard-link support before
moving the old file. The old backup is retained after success; its path appears in the queue.
The replacement uses mode `0600` where supported and does not inherit the previous item's
permissions, ownership, or ACLs. Use the Permissions action afterward where needed.

This portable sequence is not an atomic exchange: the destination name can briefly be absent.
On failure after acknowledged backup capture, mTerminal attempts to restore the old item only if
the destination remains absent. It never overwrites a concurrently created item to restore it.
Failed restoration or a lost backup/publication reply leaves the recovery path visible, with an
uncertain outcome where appropriate. Inspect both the destination and backup before retrying.
If local backup capture itself fails, a candidate backup can contain staged replacement bytes;
the queue labels failed-job paths as recovery paths, not successful original backups.

There is no automatic deletion of backups. Enable Hidden files to inspect them. Record the
original name and backup path before clearing queue records or restarting: recovery indexing is
not persisted yet. A conflict with leftover temporary/recovery files allows Skip or Cancel;
inspect those files and start a fresh transfer before attempting another replacement.
Metadata checks are not file locks or hashes; SFTP v3 cannot identify every same-size change
within its timestamp precision. The actual captured destination is retained for recovery.

## Boundaries and verification

The renderer uses validated, window-owned `files:list`, `files:mutate`, and `transfers:*` requests. Local
filesystem and SFTP access stay in the main process. No remote shell commands are constructed
for file operations. A remote operation owns a short-lived SFTP channel and directory
handle on the existing SSH connection; cleanup closes those resources without closing the shell.
Rename uses standard SFTP v3 rename rather than the OpenSSH overwrite extension, following the
[protocol's destination-exists rule](https://datatracker.ietf.org/doc/html/draft-ietf-secsh-filexfer-02#section-6.5).

Each listing is capped at 5,000 entries, with a visible partial-listing notice. Sorting and hidden
file filtering apply to that returned subset. Remote reads have a 15-second timeout and allow
one browser operation at a time per SSH session; each window permits at most four concurrent listings.
Mutations are serialized and refused while another browser operation or transfer in the window is outstanding.

Tests are written for local navigation and metadata, hidden files, unusual names, symlinks,
sorting, invalid requests and sender isolation, missing sessions, SFTP EOF handling, listing
limits, timeout/disconnect cleanup, shared-connection browsing, and the local desktop workflow.
F33 adds tests for input validation, destination preservation, nonempty deletion, symlink safety,
mode changes, partial renames, serialized IPC, remote mutation disconnects, and confirmation flows.
F34 adds tests for queue validation, ownership, ordering and limits; byte-for-byte multi-chunk and
empty-file copying; existing/concurrent destination preservation; changing sources; cancellation
and cleanup; uncertain publication; and the desktop queue's progress/cancel/clear bridge.
F35 adds tests for preview tokens, Skip, stored approvals, retained local/remote backups, stale
source/destination metadata, blocked directory replacements, cancellation/restore, concurrent
destination creation, uncertain backup capture, and the dialog's default Skip/Replace/Cancel flow.
Run them with the Phase 4 test gate. Static checks and a production build are the step-level
validation; interactive visual checks and Windows/macOS acceptance remain pending.


## Saved recovery records

F37-A persists transfer checkpoints before staging, backup moves and publication. Files shows
records needing inspection below the queue, including after restart or **Clear finished**.
**Forget record…** removes metadata only. F37-B adds **Inspect temporary file…** in a matching
SSH tab, followed by explicit confirmation and repeated identity/prefix checks before deleting
only the verified `.part` name. Older records without creation evidence require manual inspection.
F37-C adds **Resume…** with matching connection ownership, source-prefix and destination checks,
remaining-byte preview and a fresh confirmation. Resumed cancellation/failure retains the partial;
replacement still preserves the old destination in a new backup. No transfer resumes automatically. See [Transfer recovery](TRANSFER_RECOVERY.md) for storage,
planned-path caveats, cleanup limitations, resume restrictions and validation status.


## Interface update validation — F32-A

Regression code covers canonical successful history and forward branching, filtering and kind
sorting, symbolic permissions (including special bits), selected-file actions, keyboard folder
navigation, path editing, collapsed panels, existing dialogs and bidirectional drag-and-drop.
Test execution remains deferred at the user's request. Type/lint/format/build evidence is recorded
in the roadmap. The fixture-only visual preview could not be inspected because this session had
no available browser; pixel layout, real pointer interaction, live SFTP and platform acceptance
remain unverified. This update does not add a separate SFTP tab, multi-selection or folder transfer.
