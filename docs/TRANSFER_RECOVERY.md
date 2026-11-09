# Transfer recovery — F37-A/B

## Find saved records

Open **Workspace → Files** in any terminal tab. **Saved transfer recovery** appears below
Transfers when records need review. It survives application restarts, renderer reloads,
disconnections and **Clear finished**. Active jobs remain in the regular queue.

Each record shows the file, direction, local/remote folders, last recorded step and timestamp.
Where available, it includes the verified SSH address, port, username and SHA-256 host-key
fingerprint, original file metadata, and possible temporary/backup paths. Upload recovery paths
are remote; download recovery paths are local. The recorded username and fingerprint identify
the earlier connection; a new session is not automatically bound to that record.

An unfinished checkpoint is labelled **Interrupted**. This means the outcome needs inspection,
not that a crash was positively detected. A queued entry might never have started. A publication
might already have completed before its acknowledgement or final journal update.

## Inspect before retrying

Reconnect through the normal host-key verification workflow and inspect the source, destination
and reported paths. Enable **Hidden files** to see `.mterminal-<uuid>.part` and `.bak` files.
The journal records a path **before** creating or moving it, so that path may not exist. A backup
checkpoint may precede the move of the old destination; inspect the bytes before relying on it.

**Forget record…** asks for confirmation and removes only journal metadata. It never deletes,
restores or overwrites a local or remote file. Copy paths you still need before forgetting a
record. Forgetting a currently active job is refused by the main process.

## Clean a verified temporary file — F37-B

1. Connect to the recorded SSH address, port and username using the normal host-key workflow.
   Open **Files** in that SSH tab. This is also required for a local download partial: its original
   source is on the remote computer.
2. Find the specific saved record and choose **Inspect temporary file…**. No file is deleted by
   inspection. The main process matches the current verified fingerprint and account to the record.
3. Inspection requires a generated `.mterminal-<uuid>.part` sibling in the canonical destination
   folder, a creation checkpoint, a regular file still private (`0600`), and the original source
   at its recorded path/version. Local device/inode/owner/mode or remote owner/mode must match
   the creation checkpoint. Staged bytes must exactly match the current source prefix.
4. Review the local/remote path, byte count, account and fingerprint in the confirmation dialog.
   **Cancel** is focused by default. Choose **Delete temporary file** to remove that one name.
5. Confirmation expires after 60 seconds and is single-use, connection-bound and record-bound.
   Inspection runs again, comparing metadata and the SHA-256 prefix digest with the preview.
   A changed record, source, partial, connection or expired token requires a fresh inspection.

Sources, final destination names and `.bak` paths are never cleanup targets. Removing a verified
local staging hard-link name leaves other names for that inode intact. After success, only the
record's partial path is cleared; backup and transfer-outcome evidence stays available. File panes
refresh after each cleanup attempt. Forgetting a record remains a separate metadata-only action.

New transfers journal the opened, empty staging-file identity before writing data. Older records
without this evidence remain visible but cannot use automated cleanup. Missing/changed sources,
unsupported metadata, symlinks, replacement local inodes, unverified accounts and nonmatching
bytes also require manual inspection. No cleanup runs automatically or in a background scan.
Inspection streams at most 64 KiB per read within the existing 15-second SFTP operation deadline;
slow or unavailable verification leaves the file for manual inspection.

Reload, renderer loss, closing the owning connection or closing the window invalidates the
preview and aborts pending work. Cleanup is serialized with file operations, transfers and editor
preparation/uploads. A storage preflight occurs before deletion; if final persistence or a delete
acknowledgement fails, the old path may remain in the journal and the result is uncertain.

Standard SFTP exposes owner/mode/size/time metadata rather than portable inode identities, and
has no conditional unlink. Metadata and content are rechecked immediately before deletion, but
another process can still replace a name in the final check-to-unlink interval. The same path race
exists for local unlink. Avoid concurrent edits to the staging path; this is not an atomic deletion
guarantee against a hostile server or another process with the same account's write access.

## Storage and failure handling

SQLite schema 6 adds a separate `transfer_recovery` table through the existing backed-up
migration process. Journal checkpoints commit before staging, backup creation/movement and
publication. Queue acceptance is also recorded before execution. A failed journal write stops
the next transfer mutation; existing cleanup/rollback still attempts to preserve the destination.
If the final journal update fails, the earlier checkpoint remains and the queue reports an
uncertain outcome. A full or unreadable journal blocks new transfers without deleting records.

The journal holds at most 256 entries. Inspect and forget resolved entries when full. Successful
transfers without leftover temporary files or backups remove their entry automatically. Other
settled records remain available for review. Metadata is bounded and validated when read; invalid
entries are preserved rather than silently reset. No passwords, keys, passphrases, file contents
or reusable conflict approvals are stored. Workspace JSON export/import excludes the journal;
full SQLite backup/recovery includes it and may restore older, unverified evidence.

## Remaining work and validation

F37-C will add verified resume with fresh connection ownership, source/destination/partial
verification, supported server operations and explicit decisions. Copying does not resume and
old overwrite decisions are not replayed. Remote-editor preparation downloads and retained
working-copy discovery are not indexed here; explicit editor uploads use the journaled queue.

Regression code covers persistence without replay, migration, storage corruption/capacity,
creation checkpoint ordering, local/remote cleanup and retained originals, invalid ownership,
source/prefix changes, symlinks, replaced inodes, hard links, stale/expired previews, connection
matching, IPC validation, and cancellation/confirmation UI. Test execution remains deferred at
the user's request. Static/build results are recorded in `DEVELOPMENT_ROADMAP.md`; live SFTP,
actual crash/restart, visual and Windows/macOS acceptance remain pending.
