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
reconnecting the terminal, the remote browser starts again at the account's home directory.
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

F32 is read-only. Creating, renaming, deleting, editing, uploading, and downloading belong to
F33–F37. The browser does not request elevated permissions.

## Boundaries and verification

The renderer receives only directory metadata through a validated, window-owned `files:list`
request. Local filesystem and SFTP access stay in the main process. No remote shell commands
are constructed to list files. A remote listing owns a short-lived SFTP channel and directory
handle on the existing SSH connection; cleanup closes those resources without closing the shell.

Each listing is capped at 5,000 entries, with a visible partial-listing notice. Sorting and hidden
file filtering apply to that returned subset. Remote reads have a 15-second timeout and allow
one listing at a time per SSH session; each window permits at most four concurrent listings.

Tests are written for local navigation and metadata, hidden files, unusual names, symlinks,
sorting, invalid requests and sender isolation, missing sessions, SFTP EOF handling, listing
limits, timeout/disconnect cleanup, shared-connection browsing, and the local desktop workflow.
Run them with the Phase 4 test gate. Static checks and a production build are the step-level
validation; interactive visual checks and Windows/macOS acceptance remain pending.
