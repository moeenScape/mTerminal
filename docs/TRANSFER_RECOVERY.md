# Transfer recovery — F37-A

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

F37-B will add verified, explicitly selected partial-file cleanup. F37-C will add verified resume
with fresh connection ownership, source/destination checks and server-capability checks. This
part does not resume copying, reapply overwrite decisions, or delete files from journal paths.
Remote-editor preparation downloads and retained working-copy discovery are not indexed here;
explicit editor uploads use the transfer queue and are journaled.

Regression tests cover persistence without replay, migration, storage capacity/corruption,
checkpoint ordering, journal failures, IPC ownership and the confirmation flow. Test execution
is deferred at the user's request. Static/build results are recorded in `DEVELOPMENT_ROADMAP.md`;
live SFTP, crash/restart acceptance, visual and Windows/macOS verification remain pending.
