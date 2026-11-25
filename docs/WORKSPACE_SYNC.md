# Encrypted sync and sync preferences (F61–F64)

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

The metadata payload includes host and group settings, tags, jump references, and reusable SSH
identity profiles. In metadata sync, credentials, environment variables, proxy assignments, agent settings,
trusted fingerprints, logs, and terminal history stay on the device. Trust the host key
through the normal SSH connection flow on each device.

The service stores one current snapshot per account and accepts up to 1 MiB of plaintext
metadata before encoding and encryption. Ordinary publish and merge handle additions.
Use a reviewed change to propagate a record edit or deletion.

## Reviewing conflicting changes

1. Enter the sync key and choose **Review differences**. Expand **Compare values** to see
   the local and cloud versions of each differing record.
2. Choose the copy to change and select the affected hosts, groups, or identities. A record
   present only in the cloud can be explicitly deleted from the cloud. A local record can be
   deleted from this device through review only when the cloud has a deletion marker for it.
3. Confirm the selected changes. The review expires after five minutes. If either copy changes
   after preview, open a fresh review. Related records may need to be selected together to keep
   valid group, identity, and jump-host references.

Local reviewed changes use a single SQLite transaction. Updates preserve device-specific
settings. A local deletion with stored credentials, environment variables, saved forwarding,
proxy assignment, or agent options requires separate review in Hosts. Unselected records are
preserved. Opening a review pauses any automatic publication retry on the device while keeping
its encrypted batch available.

Reviewed cloud changes use version 2 snapshots, which retain deletion markers. Ordinary
publication blocks when a stale device tries to re-add a marked record, and ordinary merge
directs that device to review the deletion. To restore it, explicitly
select the local record and apply it to the cloud. Update each account service and client before
using reviewed cloud writes. Current clients can read version 1 snapshots and keep them in that
format during additive writes. After upgrade to version 2, the current service refuses writes
with an older envelope version.

## Publishing offline

After signing in online once with a current account service, keep editing hosts, groups, and
identity profiles normally. In **Encrypted workspace sync**, enter your saved sync key and
choose **Publish local records**. The app saves an encrypted publication on this device before
contacting the service. In Settings, an unreachable service leaves the queue controls available.

While mTerminal is open, it retries service outages and rate limits about every 30 seconds.
**Retry queued publication** sends the saved batch with the key you enter. A new explicit
**Publish local records** adds the current local snapshot to the queued batch. For matching
records, the new local value takes precedence within that batch. Records removed locally remain
in the queued batch. Changes made after queuing stay local until you publish them explicitly.

Queued publications are tied to the account and service address. They survive restart and
sign-out. Enter the sync key again to resume after either. A revoked or expired server session
requires signing in again. A conflict keeps the batch queued for review. Use **Discard queued
publication** to remove that copy after confirmation. Your local workspace records are kept.

## Sync preferences and credentials

Under **Settings → Account → Sync preferences for this device**, control workspace metadata
and saved SSH credentials independently. Preferences apply to the current service and account
on this device. Metadata starts enabled and credentials start disabled. Pausing metadata sync
keeps the encrypted publication queue available for later retry or discard.

To sync a credential, enable **Sync saved SSH credentials**, unlock the local SSH vault, and
select a host or identity. Hosts can publish saved passwords. Identities can publish passwords
or managed private keys with their passphrases. A paired saved login carries its username.
Enter a credential sync key or generate one for the first encrypted credential copy. The same
key may be reused from metadata sync. Each category derives separate encryption and write
values and stores a separate cloud revision.

**Publish credential** saves or replaces the selected encrypted cloud entry after confirmation.
On another device, enable credential sync, unlock its vault, and choose **Restore credential**
with the same key. The profile must already exist with the same ID and matching connection or
identity settings. Use metadata sync or a workspace backup to bring over the profile when
needed. Restore rechecks the cloud revision after confirmation and adds a credential only
when the destination slot is empty.

**Remove cloud credential** removes the selected entry and preserves the local vault copy.
Remove the cloud entry while its profile is still present on the device. Disabling credential
sync preserves any local vault records and existing encrypted cloud entries. Credential
operations are manual and need a live service connection.

The service stores credential ciphertext in a separate catalog with its own write proof and
revision. The catalog holds up to 100 credentials and follows the 1 MiB plaintext limit.
The service applies PostgreSQL migration `004_credential_sync.sql` on startup. The desktop
encrypts and decrypts credential values in the main process. The Settings screen receives
profile labels and operation results. SSH host trust remains local to each device.

## Key and service behavior

The desktop generates a random 256-bit sync key. The desktop main process derives separate
encryption and publication values with HKDF-SHA-256. It encrypts versioned snapshots with
AES-256-GCM using a fresh nonce and authenticates the account and revision as associated data.
The service receives the encrypted envelope and a separate derived publication proof. It stores
only a hash of that proof and requires it for later publications. Service calls require a valid
account session. [Node.js authenticated encryption API](https://nodejs.org/docs/latest-v24.x/api/crypto.html#deciphersetadbuffer-options)

The desktop keeps the key in memory while retrying a queued publication. The key stays on
the device and is cleared on sign-out or close. An existing encrypted copy requires its
original key. Preserve the key independently
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
envelopes, account isolation, stale writes, local merge conflicts, encrypted queue persistence,
disconnected publication, retry after a committed write loses its reply, stale reviews,
protected local deletions, downgrade rejection, independent sync preferences, credential
binding and create-only restoration, and desktop controls.
Run the desktop unit and E2E suites and the PostgreSQL integration case at the Phase 7 gate.
[Account service verification commands](ACCOUNTS.md#verification-commands)
