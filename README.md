# mTerminal

A desktop terminal and SSH/SFTP client in development for Linux, Windows, and macOS.

F01–F05 are implemented: the application window, restricted preload bridge, and initial Termius-style layout. Hosts, Workspace, and Settings views are navigable through the sidebar or keyboard-accessible tabs. Host search supports empty-result and clear states, and Settings shows real app information. Settings persist dark/light appearance, navigation shortcuts, a future shell override, and window size/maximized state. Local shells, saved-host management, and session tabs are not implemented yet. Preferences are stored in `preferences.json` under Electron’s user data directory; malformed files are preserved and prevent startup until repaired or moved aside.

## Selected stack

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
| `npm run test:unit` | Execute security boundary and renderer-location unit tests |
| `npm run test:e2e` | Build and execute Electron window/bridge tests using Playwright |
| `npm test` | Run both test suites at the phase completion gate |

**Testing cadence:** Write tests with each feature, but run them after the phase implementation is complete, as requested. Build, lint, formatting, and type checks can run during development. Tests are currently written and type-checked but have not been executed. Do not mark a feature verified merely because test code exists.

The end-to-end suite launches the installed Electron executable; it does not require downloading Playwright browsers. It needs a working desktop display, or a configured virtual display in CI, and permission to start Chromium's sandbox. Close other mTerminal instances before running it. Do not disable the application sandbox to work around a host configuration problem.

### Launch verification

The user reported that `npm run dev` opens the application on Ubuntu. This is user-reported startup evidence; it does not establish that security, lifecycle, or layout tests have passed.

An earlier agent-run launch aborted with `The SUID sandbox helper binary was found, but is not configured correctly`, and a user-namespace probe returned `Operation not permitted`. If that error recurs in another execution environment, it needs an administrator-approved Chromium sandbox configuration. No system permissions or sandbox settings were changed by the implementation.

The production build and static checks succeed. F03 visual inspection, automated runtime/security verification, and Windows/macOS checks remain pending. Tests are deferred until the Phase 0 completion gate. Roadmap checkboxes indicate implementation delivery; phase verification is recorded separately.

`npm run build` produces compiled application files, not distributable installers. Windows/macOS runtime checks, installer configuration, signing, and native terminal integration remain future work. Only the desktop workspace is enabled; the server and shared package will be added when implemented.

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

The main process initializes `mterminal.sqlite` under Electron’s user data directory before opening the window. SQLite currently holds migration history and the local workspace UUID. Preferences remain in `preferences.json`. No database or arbitrary SQL API is exposed to the renderer. See [local storage maintenance](docs/LOCAL_STORAGE.md) for backup, recovery, and lock-file handling. Storage uses Node’s built-in `node:sqlite`; no additional native package or ABI rebuild is required. Runtime/platform verification remains pending.
