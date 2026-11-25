The first mTerminal release provides a desktop terminal and SSH/SFTP workspace for Linux x64.

## Highlights

- Run local shells and SSH sessions in tabs and split panes.
- Organize saved hosts with groups and tags. Store SSH credentials in an encrypted local vault.
- Browse local and remote files, queue SFTP transfers, and recover interrupted transfers.
- Use the desktop app with local SQLite. An optional PostgreSQL-backed account service adds
  sign-in, encrypted sync, shared vaults, and live terminal collaboration.

## Install on Linux x64

Download `mterminal_0.1.0_amd64.deb` from the release assets. In the directory containing the
download, run:

```sh
sudo apt install ./mterminal_0.1.0_amd64.deb
```

Open **mTerminal** from your application menu or run `mterminal` in a terminal.

Installer SHA-256 `c089cbf0cc4034c13b22200a31f2df8bf9b464ae4156f6be5fdd42a6d53fde99`.

## Build from source

Use Node.js 24.12 or newer within Node 24 and npm 11. On Ubuntu or Debian, install the
native build prerequisites:

```sh
sudo apt update
sudo apt install build-essential python3
```

From a checkout of the repository, run:

```sh
git checkout v0.1.0
npm ci
npm run dist
```

The build writes `apps/desktop/dist/mterminal_0.1.0_amd64.deb`. Install it from the repository root:

```sh
sudo apt install ./apps/desktop/dist/mterminal_0.1.0_amd64.deb
```

## Platform and verification status

This release provides a Linux x64 installer. Minimum Ubuntu and Debian versions are still
unverified. macOS, Windows, and Linux ARM64 installers are pending. Live account and team
verification also remains open.
