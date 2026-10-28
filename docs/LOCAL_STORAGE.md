# Local storage and recovery

## Location and ownership

Electron's `app.getPath('userData')` contains `mterminal.sqlite`, its ownership file
`mterminal.sqlite.lock`, and the `backups/` directory. Typical locations are
`~/.config/mTerminal` on Linux, `~/Library/Application Support/mTerminal` on macOS,
and `%APPDATA%/mTerminal` on Windows; use your actual Electron user data path.

The main process owns one connection for the application lifetime. The renderer
has no database access. The maintenance tool uses the same ownership lock.
Files use mode `0600` on Unix; Windows access follows the directory's ACLs.
The database is not encrypted. Never store passwords, private keys, or tokens here.

## Schema and transactions

Schema v1 contains `schema_migrations` and one `workspaces` record with a generated
UUID. Schema v2 adds `hosts` with a UUID, name, address, SSH port, username, and
protocol. Host profiles contain no credentials and are included in backups. The
workspace UUID survives restarts and restores.

Schema v3 adds nested `host_groups` (fixed path, optional port/username defaults)
and host group paths, JSON tags, and per-field inheritance flags. Existing profiles
remain ungrouped with explicit connection settings. Parent groups must exist;
paths use `/` separators with at most eight levels. Removing a group subtree moves
its hosts to Ungrouped and materializes their effective settings transactionally.
Tags are normalized to lowercase, deduplicated, and limited to 20 per host.
Group defaults and organization are included in backups.

Schema v4 adds `known_hosts`, keyed by normalized server address and port, with a
SHA256 fingerprint. Trust records are separate from profiles and usernames and
are included in backups. Initial approval and checked replacement are transactional;
a changed key cannot silently overwrite a saved identity. No private keys or
credentials are stored in this table. New tables belong in subsequent
ordered migrations. Each migration and version update commits together; failed
transactions roll back. Transaction callbacks must be synchronous and must not
start asynchronous work. SQLite foreign keys are enabled.

Unknown application IDs, newer schema versions, malformed migration history, and
failed integrity checks stop startup without replacing the database. Future
schema upgrades first snapshot the existing supported database. Startup creates
one initial snapshot per schema version if absent; it is not a rolling backup.

## Offline maintenance

Quit mTerminal before running these commands from the repository root, using Node
24.12 or later in the supported Node 24 range. Replace the paths with actual ones:

```bash
npm run database -- backup "/path/to/userData" --app-closed
npm run database -- restore "/path/to/userData" "/path/to/backup.sqlite" --app-closed
```

Backup prints the new snapshot path. Manual snapshots have unique names and are
never overwritten. Publication requires a filesystem supporting hard links (for example ext4, APFS, or NTFS); unsupported filesystems fail without publishing a backup. Keep useful copies on another disk and remove obsolete copies
manually. `preferences.json` is separate and must be backed up separately.

Restore replaces only `mterminal.sqlite`. It validates the backup's application
ID, supported schema, migration history, workspace, and SQLite integrity; stages
a snapshot; preserves the old database as `.before-recovery-<uuid>`; then installs
the validated file. Restore deliberately returns the database to the backup's
state, so later changes will only exist in the preserved original. An invalid
backup or staging failure leaves the destination intact. Recovery refuses journal
sidecars rather than discarding uncheckpointed writes. Do not delete journals to
force recovery; preserve all files for investigation.

The tool refuses a lock held by the app. After a crash, a stale `.lock` can remain.
Read its PID, verify that no mTerminal or maintenance process is running, and only
then remove that lock file. Do not remove the database or journals. Restart the
application after recovery. There is no automatic restore or GUI recovery yet.

## Verification boundary

Unit tests cover stable IDs, rollback, exclusive ownership, backups, recovery,
original-file preservation, and corrupt/newer-schema rejection. These tests passed at the Phase 0 gate. Static checks and production compilation
passed; Electron runtime recovery and Windows/macOS checks remain pending.
