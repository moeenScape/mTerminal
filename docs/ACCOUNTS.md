# Accounts (F59)

## Run locally

Use the repository's Node 24 and npm 11 toolchain, a dedicated PostgreSQL database,
and an SMTP relay. For development, a local mail catcher works as the relay.

1. Run `npm ci` from the repository root.
2. Copy `apps/server/.env.example` to `apps/server/.env` and set the database URL, SMTP
   URL, and sender address. The database role needs permission to create the account
   schema objects on first start. Keep `.env` private.
3. Run `npm run start:server`. The service applies its PostgreSQL migration and binds
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
token in Electron's main process and binds any encrypted copy to the service origin. F59
does not upload local host profiles, SSH credentials, terminal content, or workspace data.

F59 is intended for development and private validation. The initial throttle is
process-local and keys off the peer address, so requests behind a reverse proxy can share
one limit. F60 covers account protection, recovery, and revocation from another device.

## Verification commands

`npm run check` type-checks both workspaces and runs lint and formatting checks.
`npm run build` also builds the desktop binaries. The server runs TypeScript directly
using the Node version in `.nvmrc`.

`npm run test:server` runs the account cases. Set `MTERMINAL_TEST_DATABASE_URL` to a
disposable PostgreSQL database to include the integration case. The test role needs
permission to create a temporary schema. The test uses an in-memory mail capture and
does not need an SMTP provider. Use `npm run test:e2e` for desktop coverage.
