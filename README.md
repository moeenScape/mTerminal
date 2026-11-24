# mTerminal

mTerminal is a desktop terminal and SSH/SFTP client with saved hosts, an encrypted local vault,
and a workspace with tabs and split panes. Accounts, encrypted synchronization, and team
collaboration use an optional account service.

## Install on Linux

Download the `.deb` from [GitHub Releases](https://github.com/moeenScape/mTerminal/releases)
when a release is available. Run this command from the directory containing the installer and
use the actual package filename:

```sh
sudo apt install ./mterminal_0.1.0_amd64.deb
```

Open **mTerminal** from the application menu. To uninstall, run `sudo apt remove mterminal`.
The install and uninstall commands use the system package manager. See the
[local storage guide](docs/LOCAL_STORAGE.md) for backup, recovery, and app data locations.

The repository currently packages Linux Debian installers. macOS and Windows packaging,
signing, and verification are pending. See the [release checklist](DEVELOPMENT_ROADMAP.md#release-engineering)
and [verification status](DEVELOPMENT_ROADMAP.md#verification-status).

## Get started

- Open **Workspace** and start a local shell. [Local terminal](docs/LOCAL_TERMINAL.md)
- Add a saved connection under **Hosts**, then choose **Connect**. Verify the server fingerprint
  through a trusted channel before approving it. [SSH sessions](docs/SSH_SESSIONS.md)
- Open **Files** from a connected SSH tab to browse and transfer files. [File browser](docs/FILE_BROWSER.md)
- Set up the local vault to save SSH credentials. For recovery and backup instructions,
  see [Local storage](docs/LOCAL_STORAGE.md).

## Feature guides

| Topic | Guides |
| --- | --- |
| Workspace | [Templates](docs/WORKSPACE_TEMPLATES.md), [snippets](docs/SNIPPETS.md), [command history](docs/COMMAND_HISTORY.md), [autocomplete](docs/AUTOCOMPLETE.md), [shell integration](docs/SHELL_INTEGRATION.md), [session logs](docs/SESSION_LOGS.md) |
| SSH and serial | [Jump hosts](docs/JUMP_HOSTS.md), [proxies](docs/PROXIES.md), [port forwarding](docs/PORT_FORWARDING.md), [SSH agent](docs/SSH_AGENT.md), [environment variables](docs/ENVIRONMENT_VARIABLES.md), [serial](docs/SERIAL.md) |
| Remote work | [Transfer recovery](docs/TRANSFER_RECOVERY.md), [remote editing](docs/REMOTE_EDITING.md), [multi-host execution](docs/MULTI_HOST_EXECUTION.md), [broadcast input](docs/BROADCAST_INPUT.md) |
| Accounts and teams | [Accounts](docs/ACCOUNTS.md), [workspace sync](docs/WORKSPACE_SYNC.md), [organizations](docs/ORGANIZATIONS.md), [shared vaults](docs/SHARED_VAULTS.md), [shared logs](docs/SHARED_LOGS.md), [live terminal](docs/LIVE_TERMINAL.md), [administrative events](docs/ADMINISTRATIVE_EVENTS.md) |
| Troubleshooting | [Diagnostics](docs/DIAGNOSTICS.md), [local storage and recovery](docs/LOCAL_STORAGE.md) |

## Develop from source

Use Node.js 24.12 or newer within Node 24 and npm 11. The first install downloads the pinned
Electron runtime and builds native modules. A native build may require Python 3 and the
platform C++ toolchain. Run from the repository root:

```sh
nvm use
npm ci
npm run dev
```

The development renderer uses `http://127.0.0.1:5173/`. Run `npm run rebuild:native` after
changing Electron or architecture. See [Accounts](docs/ACCOUNTS.md#run-locally) for PostgreSQL
and account service setup.

| Command | Purpose |
| --- | --- |
| `npm run check` | Type-check application and test code, lint and check formatting |
| `npm run format` | Format workspace source and configuration |
| `npm run build` | Type-check both workspaces and compile the desktop app |
| `npm start` | Launch the compiled desktop app |
| `npm run dist` | Build the Linux `.deb` into `apps/desktop/dist/` |
| `npm run start:server` | Start the optional PostgreSQL-backed account service |
| `npm run test:unit` | Run desktop unit tests |
| `npm run test:server` | Run server tests, including PostgreSQL coverage when configured |
| `npm run test:e2e` | Build and run Electron desktop tests with Playwright |
| `npm test` | Run desktop unit, server, and desktop E2E suites |

After building the Linux installer, install it from `apps/desktop/dist/`. Raise the version in
`apps/desktop/package.json` before building an upgrade. The desktop E2E suite uses the installed
Electron runtime and needs a display or virtual display and a working Chromium sandbox. It runs
with isolated temporary user data.

## Repository layout

| Path | Purpose |
| --- | --- |
| `apps/desktop/` | Electron and React app. Entry points are `src/main/index.ts`, `src/preload/index.ts`, and `src/renderer/src/main.tsx`. Build setup lives in `electron.vite.config.ts`. |
| `apps/server/` | Account HTTP service, PostgreSQL migrations, and tests. The entry point is `src/index.ts`. |
| `packages/shared/` | Desktop and server contracts |
| `landing-page/` | Download site and getting-started guide |
| `docs/` | Feature guides, troubleshooting, and recovery |
| `DEVELOPMENT_ROADMAP.md` | Feature scope, verification, and release checklist |

The renderer uses the validated preload API for privileged operations. Keep shell processes,
SSH credentials, filesystem access, and storage in the main process. Keep runtime databases,
preferences, and diagnostics in Electron's application data directory. Keep secrets out of
ordinary records and diagnostic logs.

## Interface direction

Give terminal sessions priority. Keep navigation, tabs, context menus, settings, and forms
compact and consistent, using Termius Desktop as a workflow reference and original mTerminal
branding and assets. Preserve keyboard access, visible focus, readable terminal text, usable
window sizes, and platform-appropriate controls.

See the [development skill](.agents/skills/mterminal-development/SKILL.md) and
[UI design skill](.agents/skills/mterminal-ui-design/SKILL.md) for contributor guidance.
