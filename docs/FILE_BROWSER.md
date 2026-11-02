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

## Navigate and inspect

- Click a folder or breadcrumb, enter an absolute path and choose **Go**, or use **Up** / **Home**.
- **Refresh** reads the current folder again. **Retry** retries a failed navigation.
- Enable **Hidden files** to show names starting with a dot.
- Sort by name, size, or modified date, ascending or descending. Directories stay first.
- Rows show byte-based file sizes, numeric mode permissions, and modification times in the
  computer's local timezone. Windows reports the mode provided by Node, not a Windows ACL.
- Symbolic links are marked **link**. Opening one resolves its directory target; a file link or
  broken link produces an error. Special files are identified without being opened.
- On failure, the last successful folder remains visible, with its breadcrumb and an error.
- Panes stack vertically in narrow windows; file tables scroll horizontally for metadata.

## Create, rename, delete, and change permissions

- **New folder** creates one folder in the pane's current directory.
- Each row's **Actions** menu offers **Rename…**, **Permissions…**, and **Delete…**. Keyboard
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
3. Choose **Upload…** from a regular local file's Actions menu, or **Download…** from a regular
   remote file's menu. These actions become available after both folders load.
4. Confirm the file name, SSH tab, direction, and both folders, then choose **Add to queue**.
5. The queue beneath the panes shows bytes transferred, progress and status. **Cancel** removes
   a queued job or interrupts an active copy; **cancelling** remains visible during cleanup.

One transfer runs at a time per window, with up to 32 jobs including finished jobs. **Clear
finished** removes only queue records; it never deletes files. Existing destinations wait for an
explicit conflict decision. Directory, symbolic-link and special-file transfers are unavailable.
There is no automatic retry, reconnect, resume or recursive transfer.

Transfers continue while you return to the terminal or switch views. Closing the SSH tab,
disconnecting its session, reloading the renderer or closing the window cancels associated work.
Queued jobs stay bound to their original SSH session; reconnecting does not replay them. Queue
records live only in memory and disappear on restart. A job captures the folder paths at enqueue
time; the filesystem and source contents are checked when it starts, not copied at enqueue time.

Copies use one 64 KiB buffer and a separate SFTP channel on the existing verified connection, so
folder listing remains available. File mutations through the browser are refused while a transfer
is active. Progress notifications are throttled to about five per second. Each SFTP request has
a 30-second deadline; cleanup requests have a separate five-second deadline. Cancellation of
local filesystem I/O waits for the OS operation to return.

Data is copied into an exclusive `.mterminal-<uuid>.part` file in the destination folder, with
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
that path before manually removing it. Crashes or forced shutdown can also leave temporary files;
automatic recovery and verified resume are deferred to F37.

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
