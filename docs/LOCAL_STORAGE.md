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

Schema v8 adds JSON `environment` columns to `hosts` and `host_groups`, defaulting to
empty arrays. These contain non-secret name/value configuration and are included in workspace
exports; passwords and tokens still belong outside this database. The existing pre-upgrade
snapshot and transactional migration preserve host IDs, connection settings and other tables.
Older version-1 workspace exports without environment entries still import normally. Group
removal materializes effective environment values alongside the existing connection defaults.
A group edit that would exceed the 32-variable effective limit rolls back completely.

Schema v9 adds `port_forwards`: saved forwarding rules (type, listen address/port,
destination) keyed by UUID, at most 20 per host, each referencing its host with
`ON DELETE CASCADE`. Rules contain no credentials. They are not yet included in workspace
exports. Running forwards are never stored; they exist only while their SSH session is open.

Schema v10 adds a nullable `jumpHostId` column to `hosts`: the saved host to connect through
first. Saves reject missing jump hosts, loops and chains longer than three hops. Deleting a
host clears references to it in the same transaction, so those hosts connect directly again.
Jump references are included in workspace exports and must resolve within the backup.

Unknown application IDs, newer schema versions, malformed migration history, and
failed integrity checks stop startup without replacing the database. Future
schema upgrades first snapshot the existing supported database. Startup creates
one initial snapshot per schema version if absent; it is not a rolling backup.

## Offline maintenance

Quit mTerminal before running these commands from the repository root, using Node
24.12 or later in the supported Node 24 range. Replace the paths with actual ones:

```bash
npm run database -- backup "/path/to/userData" --app-closed
```
```bash
npm run database -- restore "/path/to/userData" "/path/to/backup.sqlite" --app-closed

```
```bash
rm -- ~/.config/mTerminal/mterminal.sqlite.lock
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
then remove that lock file. Do not remove the database or journals.

For a missing OS keychain, restore or unlock the same operating-system account keychain
before retrying; do not remove vault files. If the vault passphrase is forgotten, or the
vault master/credential data is corrupt, choose **Reset vault** on the locked-vault screen.
After confirmation, mTerminal moves the encrypted master and credential files into a
`vault/recovery-*` folder and allows a new vault to be created. This preserves the old
ciphertext for later investigation or keychain recovery, but cannot recover secrets without
the original passphrase and OS keychain. Hosts, identities, and other SQLite metadata remain
intact. Keep the recovery folder until the new vault works; remove it manually only when
you no longer need it. Database restore remains an offline operation described above.

## Verification boundary

Unit tests cover stable IDs, rollback, exclusive ownership, backups, recovery,
original-file preservation, corrupt/newer-schema rejection, and vault reset preservation.
Static checks and production compilation passed; live keychain restoration and Windows/macOS
checks remain pending.
