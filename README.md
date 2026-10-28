# mTerminal

A planned desktop terminal and SSH/SFTP client for Linux, Windows, and macOS.

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

This repository uses a monorepo layout. The application and package directories exist as empty placeholders; there is no runnable application or configured workspace toolchain yet. Empty `.gitkeep` files preserve these directories in Git.

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

The planned desktop entry points are `apps/desktop/src/main/index.ts`, `apps/desktop/src/preload/index.ts`, `apps/desktop/src/renderer/index.html`, and `apps/desktop/src/renderer/src/main.tsx`. Create these files when configuring the desktop toolchain.

Keep desktop IPC contracts in `apps/desktop/src/shared/`; use `packages/shared/` only for contracts actually needed by both applications. Keep functionality inside its feature directory, adding modules when needed. Use `PascalCase.tsx` for React components and descriptive `kebab-case.ts` filenames for other modules.

## Process boundaries

The renderer displays the interface and terminal output. It requests operations through the preload API; it must not directly access Node.js, credentials, or arbitrary filesystem paths.

The main process validates IPC senders and payloads and owns local shell sessions, SSH connections, storage, and resource cleanup. Keep shared contracts free of privileged implementation code. Keep heavy work off the main event loop as features require it.

Store runtime databases, preferences, and logs under Electron's application data directory rather than inside the repository. Keep secrets out of ordinary records and diagnostic logs. Use `local-data/` only for ignored development data if needed.

## Development and verification

No application toolchain, runtime version, npm workspaces, scripts, or tests are configured yet. Configure root npm workspaces when adding the first package; add reproducible install, development, build, lint, and test instructions with the first application implementation. Keep a root `package-lock.json` when npm dependencies are introduced. Do not create runnable server or shared packages merely to fill the layout.

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
