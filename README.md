# mTerminal

A desktop terminal and SSH/SFTP client in development for Linux, Windows, and macOS.

F01–F31 are implemented: the application window, restricted preload bridge, Termius-style layout, local and SSH terminals, saved host/group profiles, reusable SSH identities, OS-encrypted password and private-key storage, confirmed public-key installation over SFTP, passphrase-protected vault lock/unlock, versioned workspace backup/import, and vault recovery. Secrets are saved separately from SQLite and returned only to the main process for authentication. If secure OS storage is unavailable, secrets remain session-only. Preferences are stored in `preferences.json` under Electron’s user data directory; malformed files are preserved and prevent startup until repaired or moved aside. See the roadmap for phase verification status.

## Selected stack

F32–F36 add local/SFTP browsing, folder creation, rename, confirmed file/empty-folder deletion,
permitted mode changes, queued single-file transfers, and explicit Replace/Skip/Cancel conflict
decisions with retained destination backups.
Remote text editing opens a private `.txt` working copy and uploads saved changes only on explicit
request. See [Remote editing](docs/REMOTE_EDITING.md) for limits, editor setup and copy retention.
Connect to a saved host and open **Files** from its terminal tab
to browse both computers using the verified SSH connection. See
[File browser](docs/FILE_BROWSER.md) for navigation, limits, and validation status. Drag individual
files between its Local and Remote panes, or select a file and use Upload/Download in the pane heading;
review the confirmation before adding a transfer to the queue. Compact Actions/Filter controls,
Back/Forward navigation and permissions beneath filenames keep the file lists in focus.
F37 adds persistent transfer recovery records, confirmed temporary-file cleanup and verified transfer resume in Files. See [Transfer recovery](docs/TRANSFER_RECOVERY.md)
for cleanup/resume requirements, older-record limits, overwrite confirmation and metadata-only forgetting. Phase 4 tests and live/platform acceptance remain pending.

- Electron and TypeScript for desktop lifecycle, process management, and application logic.
- React for the interface and xterm.js for terminal display/input.
- node-pty for local shells and ssh2 for remote SSH/SFTP.
- SQLite for structured local records; OS credential storage or an encrypted vault for secrets.

## Interface direction

The required visual reference is **Termius Desktop**. Build a consistent React interface across Linux, Windows, and macOS with these characteristics:

- Dark surfaces, restrained accent colors, compact spacing, clear typography, and subtle borders.
- Left navigation for hosts, credentials, snippets, forwarding, and logs as those features become available.
- A searchable saved-host view with groups, tags, recognizable connection status, and clear connection actions.
- A top tab strip for active sessions and a terminal workspace with resizable split panes and visible keyboard focus.
- An integrated SFTP view with local/remote file panes and transfer progress when SFTP is implemented.
- Consistent forms, context menus, settings, empty states, and useful error states.

Use mTerminal branding and original assets. Preserve accessible contrast, keyboard navigation, readable terminal text, and usable layouts at different window sizes. Retain platform-appropriate window controls and keyboard conventions.

The first UI milestone is the dark application shell, navigation, host view, and one working terminal tab. Add split panes and SFTP in their roadmap phases. Hide unavailable actions rather than presenting inactive features as working. Compare the implemented screens visually with the Termius reference before marking the layout complete.

## Project structure

This repository uses npm workspaces. `apps/desktop/` contains the runnable Electron/React application. The future server and cross-application package remain empty; `.gitkeep` files preserve unused directories in Git.

```text
ownterminal/
├── .agents/skills/                 # Project-specific Codex design and development skills
├── apps/
│   ├── desktop/                    # Electron + React desktop application
│   │   ├── src/
│   │   │   ├── main/               # Lifecycle, IPC, PTY, SSH/SFTP, storage
│   │   │   ├── preload/            # Narrow contextBridge API
│   │   │   ├── renderer/
│   │   │   │   └── src/
│   │   │   │       ├── components/ # Shared desktop interface components
│   │   │   │       ├── features/   # Terminal, hosts, settings, later SFTP
│   │   │   │       └── styles/     # Termius-style interface and themes
│   │   │   └── shared/             # Desktop-only IPC contracts and types
│   │   ├── tests/
│   │   │   ├── unit/               # Focused logic checks
│   │   │   ├── integration/        # PTY, SSH, SFTP, storage checks
│   │   │   └── e2e/                # Desktop workflows
│   │   └── assets/                 # Committed desktop icons and resources
│   └── server/                     # Reserved for later online services
├── packages/
│   └── shared/                     # Reserved for desktop/server contracts
├── docs/                           # Feature references and design documents
├── DEVELOPMENT_ROADMAP.md           # Feature checklist and progress log
├── AGENTS.md                       # Contributor guidelines
├── .gitignore
└── README.md
```

Implement the desktop application first. Keep `apps/server/` and `packages/shared/` empty until their features need implementation. Later server work includes accounts, synchronization, organizations, and billing.

Desktop entry points are `apps/desktop/src/main/index.ts`, `apps/desktop/src/preload/index.ts`, `apps/desktop/src/renderer/index.html`, and `apps/desktop/src/renderer/src/main.tsx`. Build configuration lives in `apps/desktop/electron.vite.config.ts`.

Keep desktop IPC contracts in `apps/desktop/src/shared/`; use `packages/shared/` only for contracts actually needed by both applications. Keep functionality inside its feature directory, adding modules when needed. Use `PascalCase.tsx` for React components and descriptive `kebab-case.ts` filenames for other modules.

## Process boundaries

The renderer displays the interface and terminal output. It requests operations through the preload API; it must not directly access Node.js, credentials, or arbitrary filesystem paths.

The main process validates IPC senders and payloads and owns local shell sessions, SSH connections, storage, and resource cleanup. Keep shared contracts free of privileged implementation code. Keep heavy work off the main event loop as features require it.

Store runtime databases, preferences, and logs under Electron's application data directory rather than inside the repository. Keep secrets out of ordinary records and diagnostic logs. Use `local-data/` only for ignored development data if needed.

## Development and verification

Use Node.js 24.12 or newer within Node 24, and npm 11. `.nvmrc` selects the initial development version. Run commands from the repository root:

```sh
nvm use
npm ci
npm run dev
```

`npm ci` uses the root lockfile. The desktop postinstall downloads the pinned Electron runtime using `install-electron`; network access is needed for the first install. Development binds the renderer to `http://127.0.0.1:5173/`; free that port if it is occupied. `npm run dev` watches main/preload changes and enables React hot reload. Close the window and stop the command with Ctrl+C when finished; on macOS, closing the window leaves the app running until Quit.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Build and launch the development desktop app |
| `npm run check` | Type-check application and test code, lint, and check formatting; does not execute tests |
| `npm run format` | Format desktop source/configuration and root JSON/JS configuration |
| `npm run build` | Type-check and compile main, preload, and renderer code |
| `npm start` | Launch the compiled app after a build |
| `npm run dist` | Type-check, build, and package a Linux `.deb` installer into `apps/desktop/dist/` |
| `npm run test:unit` | Execute security, preferences, storage, and diagnostic unit tests |
| `npm run test:e2e` | Build and execute Electron window/bridge tests using Playwright |
| `npm test` | Run both test suites at the phase completion gate |

**Testing cadence:** Write tests with each feature, but run them after the phase implementation is complete, as requested. Build, lint, formatting, and type checks can run during development. At the Phase 0 gate, all 37 unit tests passed on Linux/Node 24.12.0. Sandbox-enabled desktop tests are blocked at launch by this environment’s Chromium sandbox configuration; the phase is not fully verified.

The end-to-end suite launches the installed Electron executable; it does not require downloading Playwright browsers. It needs a working desktop display, or a configured virtual display in CI, and permission to start Chromium's sandbox. Tests use isolated temporary user data directories. Do not disable the application sandbox to work around a host configuration problem.

### Launch verification

The user reported that `npm run dev` opens the application on Ubuntu. This is user-reported startup evidence; it does not establish that security, lifecycle, or layout tests have passed.

An earlier agent-run launch aborted with `The SUID sandbox helper binary was found, but is not configured correctly`, and a user-namespace probe returned `Operation not permitted`. If that error recurs in another execution environment, it needs an administrator-approved Chromium sandbox configuration. No system permissions or sandbox settings were changed by the implementation.

The production build, static checks, and 37 unit tests pass. The sandbox-enabled desktop suite stops at launch because the chrome-sandbox helper is not configured correctly in this environment. Phase 0 implementation is complete; desktop/visual and Windows/macOS verification remain pending. Roadmap checkboxes indicate implementation delivery; phase verification is recorded separately.

### Linux installer

`npm run dist` packages mTerminal with electron-builder (`apps/desktop/electron-builder.yml`) and
writes `apps/desktop/dist/mterminal_<version>_amd64.deb`. Install or upgrade it with:

```
sudo apt install ./apps/desktop/dist/mterminal_0.1.0_amd64.deb
```

mTerminal then appears in the application menu. Uninstall with `sudo apt remove mterminal`. The
installed app uses the same data directory as development runs (`~/.config/mTerminal`). Packaging
reuses the `node-pty` build that `npm install` compiles for Electron; run `npm run rebuild:native`
first if Electron was upgraded. The icon source is `apps/desktop/build/icon.png` (512×512). Raise
`version` in `apps/desktop/package.json` before building an upgrade.

`npm run build` alone produces compiled application files, not installers. Windows/macOS installers, signing, and native terminal integration remain future work. Only the desktop workspace is enabled; the server and shared package will be added when implemented.

Expected generated directories are `out/` for compiled code, `dist/` or `release/` for distributables, and the test-report directories listed in `.gitignore`. These names are ignored within each app/package as well as at the root. Committed desktop assets belong in `apps/desktop/assets/`; avoid mixing them with generated output.

## Development plan

Start with a secure Electron window, one local terminal, tabs, and SSH. Follow [the development roadmap](DEVELOPMENT_ROADMAP.md) for all 78 features, dependencies, completion criteria, and progress tracking.

## Project skills

Project-specific Codex skills live in `.agents/skills/` and can be committed with the repository:

| Skill | Use |
| --- | --- |
| [mterminal-ui-design](.agents/skills/mterminal-ui-design/SKILL.md) | Termius-style React screens, terminal layouts, interactions, and visual verification |
| [mterminal-development](.agents/skills/mterminal-development/SKILL.md) | Electron/TypeScript implementation, secure IPC, terminal lifecycle, storage, and relevant verification |

Invoke them explicitly with `$mterminal-ui-design` or `$mterminal-development`; they also allow automatic selection for matching tasks. For example: `Use $mterminal-ui-design and $mterminal-development to implement the first terminal screen.`

If newly added skills do not appear, restart Codex. These are reusable instructions; they do not install application dependencies or replace runtime and visual checks. See the [official skill discovery documentation](https://learn.chatgpt.com/docs/build-skills).

## Git hygiene

`.gitignore` excludes dependencies, generated output, reports, local environment files, runtime development data, document build intermediates, and personal IDE files. Example environment files remain eligible for version control.

Ignore rules do not remove files already tracked by Git. The existing `.artifact-build/` intermediates and some `.idea/` files are tracked and require a separate index cleanup if they should leave future commits. Final reference documents under `docs/` remain eligible for version control.

## Local database and recovery

The main process initializes `mterminal.sqlite` under Electron’s user data directory before opening the window. SQLite holds workspace metadata; SSH secrets live separately in the vault. Preferences remain in `preferences.json`. No database or arbitrary SQL API is exposed to the renderer. See [local storage maintenance](docs/LOCAL_STORAGE.md) for database restore, keychain guidance, and vault reset behavior. SQLite uses Node’s built-in `node:sqlite`. The local terminal uses the separate native `node-pty` package, rebuilt for Electron during installation. Runtime/platform verification remains pending.

If you forget the vault passphrase, **Reset vault** preserves the encrypted source files under
`vault/recovery-*` and lets you create a new vault; it does not recover those saved credentials.

## Session output logs (F48)

Unlock the vault, open **Logs** in the session strip, choose a running local or connected SSH
terminal, and review the sensitive-output warning before starting. The **Recording** indicator
stays visible while capture runs. Reopen Logs to stop, read output, save notes/bookmarks, or
confirm deletion. Closing the panel keeps recording; locking the vault stops it.

Output can include secrets and is not automatically redacted. Logs are encrypted, bounded to
four recordings of 32,768 characters each, checkpointed every two seconds, and expire after
30 days when accessed. See [session log usage, privacy and limits](docs/SESSION_LOGS.md).

## Diagnostics

Startup and storage failures show fixed recovery instructions and an event code. Diagnostics are stored under `userData/logs/diagnostics.log`, with bounded rotation and no raw error messages or application payloads. See [diagnostics and troubleshooting](docs/DIAGNOSTICS.md).

## Local terminal (F07)

Local Bash terminals support opt-in encrypted command history and inline suggestions.
Open **History**, enable recording, then open a new Bash terminal. See
[command history setup and privacy](docs/COMMAND_HISTORY.md).

F46 adds a compact per-pane shell status: last reported directory, prompt/waiting/running state,
and the last completed command line's exit code. It works with local Bash 5.1+ and `base64`/`tr`,
even when history recording is off. Other shells and SSH show unsupported status. See
[shell integration and limitations](docs/SHELL_INTEGRATION.md).

F47.1 adds safe single-line saved snippets to that same autocomplete popup. Unlock the vault,
type a snippet command's prefix, and select its **Snippet** row to insert it for review.
Snippet selection never submits Enter; highlighted history rows retain Enter-to-run behavior.
F47.2 also offers local file/folder paths from the recognized prompt, with escaped literal
filenames and insert-only acceptance. Try `cat ./rea`, `cd ../Doc`, or `cat ~/Doc`. See
[autocomplete sources](docs/AUTOCOMPLETE.md). F47.3 adds insert-only Git/npm/ls subcommand
and flag hints, such as `git status --sh` and `npm install --save-d`, with a documented static
catalog and grammar limits. These hints do not run commands or verify installed CLI versions.

Run `npm run dev` from the repository root, open **Workspace**, and choose **Start
local shell** or **New terminal**. Input goes to the real shell; output is rendered by xterm.js. Use
**Close session** to stop it. Changing views preserves the running terminal;
reloading the app or closing the window ends it. Settings' default shell override
must be an existing absolute executable path without arguments or surrounding quotes and applies to new sessions. Invalid overrides are rejected before saving and checked again at launch. Leaving the field blank uses a valid Unix `$SHELL`, then Bash on Linux or Zsh on macOS; Windows prefers PowerShell before cmd.

`npm install` now rebuilds node-pty for the installed Electron version. If Electron
or your machine architecture changes, run `npm run rebuild:native`. Building may
require Python 3 and a C++ toolchain: `build-essential` on Ubuntu, Xcode command-line
tools on macOS, or MSVC/Windows SDK on Windows. Installers are not configured yet.
See [local terminal implementation and limits](docs/LOCAL_TERMINAL.md).

F07 build/static checks and native-module loading pass on Linux x64. New terminal
tests are written but deferred until the Phase 1 gate. Phase 0's sandbox-enabled
desktop verification remains outstanding; no interactive/visual or Windows/macOS
pass is claimed.

F08 adds deterministic platform fallbacks and specific missing/invalid-shell errors. Its tests are written and type-checked but deferred to the Phase 1 gate; Windows/macOS behavior has not been runtime-verified.

F09 forwards Unicode text, control sequences and binary terminal reports through
validated IPC. Unicode 11 character widths are enabled; complex shaping, modern
emoji clusters and native IME behavior still need manual compatibility checks.
On Linux/Windows, native menu actions use Ctrl+Shift combinations (for example
copy/paste and development reload) so Ctrl+C, Ctrl+W and Ctrl+R remain shell input.
macOS keeps its native Command menu shortcuts. Phase 1 tests remain deferred.

F10 keeps the emulator and PTY on one bounded grid during window/workspace
resizing. Hidden workspaces retain their size and catch up when shown; resizes
received during shell startup are retained. Notifications are coalesced, and
font/scale changes request a fresh fit. Tests are written and type-checked but
remain deferred to the Phase 1 gate; native visual/DPI checks are still pending.

F11 adds independent terminal tabs. Use New terminal, double-click or Rename to
change a label, and drag tabs or use Move left/right to reorder. Arrow/Home/End
navigate the focused tab strip; F2 renames, Delete closes, and Alt+Shift+Arrow moves
a tab. Closing a running/starting tab asks for confirmation naming that tab.
Labels, order and scrollback remain in memory and are discarded on reload.
The feature tests are written/type-checked but deferred; native/visual/platform
verification remains pending.

F38-A adds **Split right** and **Split down** in the terminal’s More actions menu and the tab
context menu. Local panes open independent shells; SSH panes start a separate connection to
the same host, using its saved login or asking for credentials. Click a pane or select its tab
to focus it. Each session keeps its tab; selecting any tab in a split group shows the group.
Close confirms live work and removes only that pane, expanding the survivors. New terminal
opens an independent tab outside the current group. Layouts last for this app session.

F38-B adds draggable dividers. Drag a boundary or double-click it to balance the adjoining
branches. Focus a divider with Tab and use its arrow keys to resize, Home/End for limits,
or Enter to balance. Escape cancels an active drag. Panes keep at least 260 × 160 CSS pixels;
small windows scroll the layout rather than hiding sessions. Resizing keeps the original
terminal and SSH sessions alive and updates their terminal grids.

From terminal input, **Alt+Shift+Arrow** focuses a pane in that direction, and
**Ctrl+Alt+Shift+Arrow** moves the nearest divider on that axis by two percentage points.
At an outside edge, focus stays put. These shortcuts skip dialogs, menus and search fields;
Settings → Enable workspace and pane navigation shortcuts controls them. On macOS, use
Option for Alt; Control remains Control. Divider keys continue to work independently of
that setting. Window shrinkage temporarily clamps sizes and restores the preferred ratios
when space returns. Native keyboard, drag, accessibility and cross-platform acceptance
remain pending; regression tests are written and execution deferred.

F39 adds **Workspace templates** beside New terminal. Save the current tabs and split layout
under a unique name, review a saved template, then **Open layout** to add fresh idle panes.
Start or connect each pane explicitly; existing sessions stay open and commands are never
replayed. Templates survive app restarts and exclude credentials and terminal output.
See [workspace templates](docs/WORKSPACE_TEMPLATES.md) for limits, deletion and backup scope.

F40 adds **Terminal tools → Snippets** (also in More actions). Save encrypted reusable
commands with folders and tags, search/edit/delete them, insert a single line without Enter,
or review and confirm **Run…** for the selected session. Multiline snippets require Run;
a changed session cannot receive a pending command. The local vault must be open.
See [snippets](docs/SNIPPETS.md) for storage, limits and shell-prompt requirements.

F41 adds a startup assignment in **Terminal tools → Snippets** for local terminals or the
current SSH host. New connections show **Review startup / Skip startup**. The full command
requires confirmation; cancel/skip or an attempted submission consumes the action for that
connection. Reconnect offers a fresh review and never silently replays commands. Assignments
stay in the encrypted vault; see [startup assignments](docs/SNIPPETS.md#startup-assignments).

F42 adds **Run on hosts** beside Workspace templates. Select connected SSH accounts, review
the command and destinations, then run once through separate exec channels. Per-host results
include stdout/stderr and exit status; concurrency, timeout and output limits are bounded.
Cancellation closes channels and may leave remote processes running. See
[multiple-host execution](docs/MULTI_HOST_EXECUTION.md) for environment and lifecycle details.

F43 adds **Broadcast input** in the session strip. Select connected SSH sessions, then use
its visible input bar: Enter sends text, Shift+Enter adds a line, and multiline text needs
review. Stop broadcast, Escape in the bar, or Ctrl+Shift+B / Command+Shift+B disarms it.
Ordinary pane typing stays in that pane. Disconnects, focus loss, leaving Workspace and
vault lock also stop broadcasting. See [broadcast input](docs/BROADCAST_INPUT.md).

F45 adds **Environment variables** to host and group editors. Parent group values flow down
to child groups; host values override matching names. New SSH shells and **Run on hosts** use
the connection's saved snapshot. Values are non-secret configuration, stored unencrypted and
included in workspace exports. The remote server must allow the names through `AcceptEnv`;
a successful connection does not confirm acceptance. See [environment variables](docs/ENVIRONMENT_VARIABLES.md).

F49 adds **Port forwarding…** to the ⋯ menu of SSH tabs. Save local, remote and dynamic
(SOCKS5) rules per host, then Start/Stop them on the connected session and watch their status
and open connections. Forwards listen on 127.0.0.1 by default and stop when the session
disconnects or closes. See [port forwarding](docs/PORT_FORWARDING.md).

F12 adds **Copy selection**, **Paste**, and **Select all** inside each terminal.
Copy/paste shortcuts use Ctrl+Shift+C/V on Linux/Windows and Command+C/V on macOS.
Multiline text or control characters opens a preview naming the destination tab;
Cancel sends nothing. Paste is discarded if the captured session is no longer
ready or visible. Clipboard text is limited to 1 Mi UTF-16 units, and terminal
OSC 52 requests cannot access the clipboard through the app. Clipboard contents
and previews are not written to diagnostic logs. Tests are written/type-checked
but deferred to the Phase 1 gate; native clipboard/keyboard behavior is unverified.

F13 adds per-tab literal search with match-case and previous/next navigation. Use Search or Ctrl+Shift+F (Command+F on macOS); Enter and Shift+Enter navigate matches, Escape closes search, and Bottom returns to live output. Scrollback retains up to 3,000 lines. Tests are deferred until the Phase 1 gate.

F14 adds per-tab terminal appearance controls for theme, font, size, zoom, cursor shape and blink. Open **Terminal appearance** in a tab; settings last for the current app session. Tests and native visual verification remain pending.

## SSH sessions

Save an SSH profile in Hosts, then choose Connect. Enter a username and authentication details
when no saved login is available. Check **Save username and password for this host** to store
the complete login securely on this device. Future **Connect** clicks use that login without
asking again, even after closing the terminal tab. Leave the box unchecked for a one-time login.
Unlock the vault again after restarting the app. Unknown server keys require confirmation after comparing
the fingerprint through a trusted channel. Approved keys are saved by address
and port; changed keys refuse the current connection. An optional expected
fingerprint adds an explicit pin. Passwords and private keys can be saved securely
to an assigned identity on this device.
See [SSH session setup](docs/SSH_SESSIONS.md) for details and current limitations. Group port/username defaults apply to new connections.

SSH authentication supports passwords, private-key files with optional passphrases,
and keyboard-interactive challenges (including optional MFA continuation after
password/key authentication). Unsaved credentials remain session-only.

Hosts assigned a managed-key identity can install that public key to the remote account's
`~/.ssh/authorized_keys` after confirming the target and key. The server fingerprint must
already be trusted; authentication currently uses the identity's saved password or a
one-time password. Existing authorized keys are preserved.

SSH tabs display Connecting, Verifying key, Authenticating, Opening shell and
Connected progress. Completed connections retain output and show Disconnected
or Failed; retry is explicit.

F23 enables 15-second SSH keepalive probes with three unanswered probes allowed.
A stalled peer is normally closed on the following probe (about 60 seconds).
After loss/exit, **Reconnect SSH** requests fresh credentials and starts a new
shell. Its prompt warns that submitting clears displayed output; cancelling
keeps it. Connections and previous commands are never replayed automatically.

F24 adds **Cancel connection** during SSH setup and in identity/authentication
prompts. Cancellation keeps the terminal tab and output, closes pending network
resources and ignores late replies. Phase 2's unit gate passed (113 tests on
Linux/Node 24.12.0). Desktop launch remains blocked by the recorded sandbox
configuration error; visual and Windows/macOS acceptance are still pending.

Set up the local vault from the sidebar. It locks after five minutes without activity and
whenever mTerminal restarts. Locking blocks new saved-credential reads and hides the workspace;
existing SSH sessions stay connected. The vault passphrase cannot be reset if forgotten, so
keep it safe. Host and identity metadata remain local but are not encrypted by the vault
passphrase.

Use **Settings → Workspace backup** to export versioned workspace metadata or merge it from a
backup. Passwords and private keys are excluded. Imports require confirmation and abort entirely
if any record conflicts with existing data.
