# Remote text editing

## Open and edit

1. Connect to a saved SSH host, then open **Files** in its terminal tab.
2. Open a remote file's **Actions** menu and choose **Edit in local editor…**.
3. Review the remote path and plaintext-copy notice, then choose **Download and open**.
4. The **Remote editor** panel shows preparation, the working-copy path and saved-change status.
5. Edit and save in the external editor. Saves stay local; choose **Upload changes** explicitly.

One editing session is allowed per application window. Supported files are regular UTF-8 text
up to 1 MiB, allowing tabs and CR/LF but rejecting binary control characters and invalid UTF-8.
Use ordinary Download for binary or unsupported encodings.

The generated working file is always named `editing.txt`, even when the remote source is a
script, desktop launcher or another executable-looking name. Only this generated text path is
opened, using the system's default `.txt` application. Set that association to your preferred
text editor. If launching fails, the copy stays available; choose **Open editor** after fixing
the association. The app uses Electron's [main-process `shell.openPath`](https://www.electronjs.org/docs/latest/api/shell#shellopenpathpath).

## Upload saved changes

Saved bytes are hashed about once per second. **Saved changes pending** means the copy differs
from the downloaded or last acknowledged uploaded version. Unsaved editor buffers cannot be read
or detected. Save the intended version completely before uploading.

**Upload changes** takes a separate, bounded snapshot and adds a job to the existing transfer
queue. Later saves in the editor do not alter those upload bytes. When the transfer succeeds,
only that snapshot is marked uploaded; newer local saves remain pending.

The original remote metadata is checked at transfer start and before publication. If it still
matches, the explicit Upload action authorizes a staged replacement with a retained remote
backup. If it changed, the queue shows **conflict**: use **Resolve…** to review the new metadata
and choose Replace, Skip (default), or Cancel. Skip and Cancel keep saved local edits.

Replacements use mode `0600` where supported; previous permissions/ownership/ACLs are not copied.
Use the file browser's Permissions action afterward where appropriate. Replacement is not an
atomic exchange, and metadata checks are not file locks or content hashes. SFTP timestamp
precision can miss same-size changes within a second. See [File browser](FILE_BROWSER.md) for
backup, guarded restore and uncertain-outcome behavior.

An uncertain upload blocks another upload from the same editing session. The working copy and
immutable upload snapshot remain available for inspection. Recovery/temporary paths appear in
the panel and queue. Inspect the remote file and backups before starting a fresh editing session.

## Keep or discard the copy

- **Keep copy and finish** releases the editing slot and reports the retained working folder.
  During preparation this also cancels the download. The external editor is not terminated.
- **Discard local copy…** shows the exact working folder and asks for confirmation. Close the
  editor first: this permanently removes the folder, saved edits, upload snapshots and editor
  backup files. It does not delete the remote file or remote backups.
- Finish/discard is refused while an upload or conflict is active. Cancel or resolve its queue
  job first, then wait for cleanup.
- Disconnecting SSH keeps the copy and permits reopening it locally. Upload stays bound to the
  original verified SSH session; reconnecting never rebinds or uploads automatically.

Copies also survive application shutdown. After restart, they are not automatically indexed or
reopened. Record the working folder and remote recovery paths before finishing or closing. A
kept copy can be opened manually; its `origin.json` records the original source metadata and
tab label, not credentials or file contents. Recovery indexing/rebinding follows in F37.

## Storage and boundaries

Working folders live under `<Electron userData>/remote-edits/edit-*`. They are plaintext and
are not protected by vault encryption. POSIX folders use mode `0700` and initial files `0600`;
Windows uses inherited filesystem ACLs. Standard workspace JSON exports do not include copies.
There is no automatic removal of kept working folders or remote backups.

The renderer receives status and paths, never document contents. Validated, window-owned
`remote-edit:*` requests accept only a saved-session file selection or fixed actions. The
renderer cannot supply a local editor command, working-copy path or deletion path. Downloads
reuse the fingerprint-verified SSH connection and enforce the byte limit before copying.
Local readers reject symlinks, cap reads and check file identity/metadata during snapshotting.

Regression tests cover text/size/request validation, private text-only launch paths, explicit
uploads, immutable snapshots, later saved changes, conflict/uncertain outcomes, disconnects,
launch failure, kept copies, scoped discard, IPC isolation and the panel workflow. They are
written and type-checked, with execution deferred to the Phase 4 gate. Static checks and build
are step-level evidence; actual OS editor launch, live SSH/SFTP, visual and cross-platform
acceptance remain pending.
