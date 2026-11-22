# Encrypted workspace sync (F61)

## Publish and merge

Sign in on the account service and open **Settings → Account → Encrypted workspace
sync**. On the first device, generate a sync key and save it privately before choosing
**Publish local records**. On another device, sign in to the same account, enter the same
key, and choose **Merge cloud records**. Use the key again for each operation.

Publication adds local records to the account’s current encrypted copy. Merge adds cloud
records to the local workspace in one SQLite transaction. Matching records are skipped. A
different record with the same identity stops the operation before any records are written.
Simultaneous publications use a revision check so a stale write cannot replace a newer copy.
If a publication loses the race, retry to read and combine the latest version.

The payload includes host and group settings, tags, jump references, and reusable SSH
identity profiles. Credentials, environment variables, proxy assignments, agent settings,
trusted fingerprints, logs, and terminal history stay on the device. Trust the host key
through the normal SSH connection flow on each device.

F61 handles additions. Offline sync, propagating edits and deletions, and resolving divergent
records are later roadmap steps. The service stores one current snapshot per account and
accepts up to 1 MiB of plaintext metadata before encoding and encryption.

## Key and service behavior

The desktop generates a random 256-bit sync key. The desktop main process derives separate
encryption and publication values with HKDF-SHA-256. It encrypts version 1 snapshots with
AES-256-GCM using a fresh nonce and authenticates the account and revision as associated data.
The service receives the encrypted envelope and a separate derived publication proof. It stores
only a hash of that proof and requires it for later publications. Service calls require a valid
account session. [Node.js authenticated encryption API](https://nodejs.org/docs/latest-v24.x/api/crypto.html#deciphersetadbuffer-options)

The sync key is entered for each operation and is neither persisted by the app nor sent to the
service. An existing encrypted copy requires its original key. Preserve the key independently
of the account password. If a device is lost, revoke its account session from another device.
Revocation ends service access from that session. A device that already copied the key and
ciphertext can still decrypt its copy. Losing the key makes the cloud copy unreadable.

The account service applies PostgreSQL migration `003_workspace_sync.sql` on startup. Keep
the account service behind the existing HTTPS configuration and allow the sync endpoint's
encoded request and response size of 1,399,126 bytes through the reverse proxy.

Independent security review is pending. This version does not provide client-side detection
of deliberate rollback by the service or key rotation.

## Verification

The regression cases cover encrypted envelopes and data exclusion, wrong keys or altered
envelopes, account isolation, stale writes, local merge conflicts, and the desktop controls.
Run the desktop unit and E2E suites and the PostgreSQL integration case at the Phase 7 gate.
[Account service verification commands](ACCOUNTS.md#verification-commands)
