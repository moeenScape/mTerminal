# Accounts, account protection, and devices (F59–F60, F65)

## Run locally

Use the repository's Node 24 and npm 11 toolchain, a dedicated PostgreSQL database,
and an SMTP relay. For development, a local mail catcher works as the relay.

1. Run `npm ci` from the repository root.
2. Copy `apps/server/.env.example` to `apps/server/.env` and set the database URL, SMTP
   URL, and sender address. Generate a random `MTERMINAL_ACCOUNT_MFA_KEY` with
   `openssl rand -hex 32`. Keep the key private and back it up with your deployment secrets.
   Every server process must use the same key. The database role needs permission to create
   and migrate the account schema.
3. Run `npm run start:server`. The service applies its PostgreSQL migrations and binds
   to `127.0.0.1:8787` by default.
4. Run `MTERMINAL_ACCOUNT_URL=http://127.0.0.1:8787 npm run dev` and open
   **Settings → Account**. Set the environment variable in your shell before running
   the app if your shell uses different environment assignment syntax.

For packaged clients, configure `MTERMINAL_ACCOUNT_URL` as an HTTPS origin. Serve the
loopback service behind an HTTPS reverse proxy. Plain HTTP is accepted only for loopback
development clients. Non-loopback SMTP requires encrypted transport. With no configured
account origin, users can continue using the local terminal, SSH, SFTP, and the SSH vault.

## Account flow

Choose **Create account**, request a code, then enter the code from email and choose a
password. Codes expire after 20 minutes and are consumed once. A code can be requested
again after one minute. The password is set only after proof of access to the mailbox.

After verifying or signing in, Settings shows the current device, recent devices, and
active sessions. Sign-in replaces any previous session on the same installation. Sessions
expire after 30 days. **Sign out** invalidates the current server session and clears the
local copy. The server must be reachable to complete sign-out. A secure OS credential
backend can retain the session across restarts. Otherwise, the desktop keeps it in memory.

The server stores the verified email, salted scrypt password hash, hashed verification
and session tokens, and device and session metadata. The desktop keeps its account session
token in Electron's main process and binds any encrypted copy to the service origin. Use
[encrypted workspace sync](WORKSPACE_SYNC.md) to publish supported metadata explicitly.

## Account protection

- Under **Settings → Account → Two-factor authentication**, enter your current password,
  add the displayed key manually to a time-based entry in your authenticator app, then enter
  its six-digit code within ten minutes. Save the eight one-time recovery
  codes privately when they appear. Enabling or disabling the authenticator signs out other devices.
- To sign in with two-factor authentication, enter your password and a fresh authenticator code
  or an unused recovery code. An authenticator code accepted earlier cannot be used again.
- **Forgot password** sends a one-time email code valid for 20 minutes. Accounts with two-factor
  authentication also require an authenticator or recovery code. A successful reset revokes all
  account sessions. Sign in with the new password afterward.
- Under **Active sessions**, select **Revoke** beside another device to end that session. The device
  remains in the recent device list and must sign in again.

The server stores encrypted authenticator keys and hashes of recovery codes. Losing the server
encryption key prevents validation of existing authenticator codes. Stop any F59 server processes
before upgrading the service and database. Keep F60 or later on every server after enabling MFA.

Password requests and account changes are limited by persistent PostgreSQL counters. The limits
are 50 POST attempts per peer per minute, 3 registration or recovery requests per address per
minute per endpoint, 8 verification, sign-in, or reset attempts per address per minute per endpoint,
and 12 protection requests per session per minute. To assign client IP limits behind a trusted local
reverse proxy, set `MTERMINAL_TRUST_ACCOUNT_PROXY=1` and configure the proxy to overwrite
`X-Real-IP` with the actual client IP. Keep the backend port private. Otherwise, requests through a
proxy share its address for throttling.

## Device lifecycle and SSH public keys

Under **Settings → Account → Devices**, rename a device to make it easier to recognize. Each
installation uses its existing workspace ID to associate account sessions with that device.
The identifier is an account-management label. Account authentication still uses the password,
configured MFA, and the session token.

Use **Retire** on a lost or unused device. Migration 005 adds a retirement state. Retirement
ends its account sessions, removes its public-key directory entries, and blocks sign-in with
that installation ID. **Allow sign-in** on another signed-in device clears the retirement.
The restored device must authenticate again and publish any keys it wants to list. A fresh
installation with a new ID can authenticate with the account credentials and configured MFA.

Retirement preserves the local workspace, SSH vault, queued workspace publications, and
account cloud snapshots. If an installation is lost and account credentials may have been
exposed, use the account's password reset flow to revoke all sessions and rotate any SSH
credentials that may have been exposed.

The **SSH public-key directory** is optional and visible to signed-in devices on the same
account. Choose a managed key from the unlocked vault and confirm publication. The service
stores the public key, its fingerprint and display label, and the owning device and
identity IDs. The desktop strips the key comment before sending it. The key's private material,
passphrase, and SSH username stay on the device for this operation.

Publish again from the same installation and identity to replace a directory entry after key
rotation. The directory allows up to 100 entries per account. You can copy an entry's public
key or remove the entry, including when the publishing device is offline. Directory removal
and retirement leave any copies authorized on SSH servers. Remove those keys on each server
to revoke SSH access there.

Deploy the F65 service and migration before using the directory in the desktop. Directory reads
and writes have a separate limit of 50 requests per peer per minute.

## Verification commands

`npm run check` type-checks both workspaces and runs lint and formatting checks.
`npm run build` also builds the desktop binaries. The server runs TypeScript directly
using the Node version in `.nvmrc`.

`npm run test:server` runs the account cases. Set `MTERMINAL_TEST_DATABASE_URL` to a
disposable PostgreSQL database to include the integration case. The test role needs
permission to create a temporary schema. The test uses an in-memory mail capture and
does not need an SMTP provider. Use `npm run test:e2e` for desktop coverage.
