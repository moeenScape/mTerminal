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
privileges. Editing, uploading, and downloading follow in F34–F37.

## Boundaries and verification

The renderer uses validated, window-owned `files:list` and `files:mutate` requests. Local
filesystem and SFTP access stay in the main process. No remote shell commands are constructed
for file operations. A remote operation owns a short-lived SFTP channel and directory
handle on the existing SSH connection; cleanup closes those resources without closing the shell.
Rename uses standard SFTP v3 rename rather than the OpenSSH overwrite extension, following the
[protocol's destination-exists rule](https://datatracker.ietf.org/doc/html/draft-ietf-secsh-filexfer-02#section-6.5).

Each listing is capped at 5,000 entries, with a visible partial-listing notice. Sorting and hidden
file filtering apply to that returned subset. Remote reads have a 15-second timeout and allow
one operation at a time per SSH session; each window permits at most four concurrent listings.
Mutations are serialized and refused while another file operation in the window is outstanding.

Tests are written for local navigation and metadata, hidden files, unusual names, symlinks,
sorting, invalid requests and sender isolation, missing sessions, SFTP EOF handling, listing
limits, timeout/disconnect cleanup, shared-connection browsing, and the local desktop workflow.
F33 adds tests for input validation, destination preservation, nonempty deletion, symlink safety,
mode changes, partial renames, serialized IPC, remote mutation disconnects, and confirmation flows.
Run them with the Phase 4 test gate. Static checks and a production build are the step-level
validation; interactive visual checks and Windows/macOS acceptance remain pending.
