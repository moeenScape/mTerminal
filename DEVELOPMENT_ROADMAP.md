# Terminal Development Roadmap

Created: 2026-10-28  
Target platforms: Ubuntu/Linux, Windows, and macOS  
Scope: A Termius-style desktop terminal and infrastructure client  
Excluded: Mobile applications

This is a proposed development plan based on public capabilities, not a claim of exact Termius parity or a description of its private implementation. Validate dependency compatibility, platform support, and security boundaries during implementation.

## Development tracking

- Unchecked means implementation is planned or incomplete; checked means the implementation step is delivered. Phase verification is tracked separately: a checked feature does not mean its deferred tests or all platform checks have passed.
- Keep feature IDs stable and reference them in commits, issues, and pull requests.
- At the end of each implemented step, stage its related changes and commit using `Phase <number> / F<id>: <imperative summary>`. Do not push.
- Record active work, blockers, implementation links, and validation evidence below.
- Record which operating systems were actually tested.
- A successful build alone does not establish runtime compatibility.
- Update this roadmap when scope, technology choices, or platform support changes.
- Do not mark a phase complete until its completion criteria are met.
- Write tests alongside features; execute them after the phase implementation is complete. During feature development, build, lint, formatting, and type checks may run without executing tests. Record deferred test execution explicitly.

## Current progress

| Field | Value |
| --- | --- |
| Current milestone | M1 — Local terminal and SSH |
| Active feature | F14 implemented; Phase 1 in progress; Phase 0 desktop verification remains incomplete |
| Next feature | F15 — Complete platform-specific orphan prevention; outstanding Phase 0 sandbox verification remains recorded |
| Implementation status | F01–F14 implemented: desktop foundation, restricted bridge, navigation, Hosts/Workspace/Settings views, preferences, SQLite foundation, actionable failures, safe diagnostics, owned local PTY sessions, platform shell defaults, Unicode/text/binary terminal input/output, synchronized resizing, independent terminal tabs, and clipboard controls; desktop verification pending |
| Runtime evidence | User reported the application opens on Ubuntu; automated security and F03 visual verification remain pending |
| Current blocker | Sandbox-enabled E2E launch aborts: chrome-sandbox ownership/mode is invalid in this environment; no OS permissions changed |
| Phase 0 verification | 37/37 unit tests passed on Linux/Node 24.12.0; static/build checks pass. Sandbox-enabled E2E: first launch blocked, remaining 9 not run (fail-fast). Visual and Windows/macOS verification pending |
| Last roadmap update | 2026-10-28 |

## Selected technology stack

| Component | Technology | Purpose |
| --- | --- | --- |
| Language | TypeScript | Application and interface logic |
| Desktop framework | Electron | Cross-platform lifecycle and native integration |
| Interface | React | Hosts, tabs, panes, settings, and connection state |
| Terminal emulator | xterm.js | Terminal display and input |
| Local shell integration | node-pty | Connect terminal sessions to installed shells |
| SSH and SFTP | ssh2 | Remote shell channels and file operations |
| Local structured storage | SQLite | Records, migrations, and transactions |
| Secrets | OS credential storage or encrypted vault | Keep secrets separate from ordinary records |
| Later online services | TypeScript backend and PostgreSQL | Accounts, encrypted sync, organizations, and billing |
| Verification | Unit tests, integration tests, Playwright | Validate application behavior and desktop workflows |

The Electron, TypeScript, React, xterm.js, and node-pty foundation is selected. The monorepo places desktop work in `apps/desktop/`, reserves `apps/server/` for later online services, and reserves `packages/shared/` for cross-application contracts. Keep the latter two empty until needed. Add SSH, storage, and online services when their phases begin. Mosh, hardware keys, certificates, serial connections, and modern cryptographic algorithms need separate investigations. No online backend is required for the initial local terminal and SSH workflows.

## Milestones and dependencies

| Milestone | Phases | Deliverable | Status |
| --- | --- | --- | --- |
| M1 | 0–2 | Local terminal, tabs, host management, SSH | In progress |
| M2 | 3–4 | Secure persistent credentials and SFTP | Planned |
| M3 | 5–6 | Workspaces, automation, logs, advanced connections | Planned |
| M4 | 7 | Accounts and encrypted synchronization | Planned |
| M5 | 8 | Shared vaults and collaboration | Planned |
| M6 | 9 | AI, integrations, enterprise and commercial features | Planned |

Release engineering applies throughout development. Implement phases in order unless a feature has an independent, reviewed dependency path. Do not postpone host verification or persist plaintext secrets while waiting for secure storage.

## Phase 0 — Application foundation

Dependencies: None.

- [x] **F01 — Desktop window:** Application lifecycle, menus, window controls, and single-instance behavior. Implementation complete; user reported Ubuntu launch succeeds. Lifecycle tests and other platforms remain pending.
- [x] **F02 — Secure process boundaries:** Isolated renderer, narrow preload API, validated IPC, and sender checks. Implementation complete with a read-only app-info bridge; security tests remain pending.
- [x] **F03 — Application layout:** Termius-style dark shell, navigation, Hosts/Workspace/Settings views, host-search empty states, keyboard-accessible view tabs, and application/session status. Implementation complete; visual and phase tests pending. Actual session tabs belong to F11 and saved-host management to F17. Follow the [interface direction](README.md#interface-direction).
- [x] **F04 — Preferences:** Persisted dark/light appearance, navigation shortcut toggle, default-shell path, and window size/maximized state. Shell selection is consumed by F07; platform defaults and save-time validation are implemented in F08. Runtime and phase tests pending.
- [x] **F05 — Local database:** Main-process SQLite, ordered transactional schema migrations, persistent workspace UUID, integrity/version checks, startup snapshot, pre-upgrade backups, exclusive ownership, and offline backup/restore maintenance. Build/static checks passed; runtime and phase tests pending.
- [x] **F06 — Error handling:** Fixed failure codes and recovery messages, sanitized preference-save results, bounded local diagnostic logs, fatal-process and renderer-crash handling. Unit/static/build checks pass; sandbox-enabled desktop verification blocked by the environment.

Completion criteria: The application opens reliably, persists preferences, handles failures, and rejects invalid IPC requests. Keep process execution, filesystem access, and credentials outside the renderer.

UI acceptance: Compare the application shell and host view visually with Termius Desktop. Verify consistent dark styling, compact spacing, accessible contrast, keyboard focus, resizing, and platform-appropriate window controls. Use mTerminal branding. Terminal tabs, split panes, and SFTP follow their respective feature phases.

Document source layout, runtime versions, entry points, dependency installation, development, build, lint, and test commands in `README.md`. Configure formatting/linting and a suitable test framework with the first implementation, and commit the dependency lockfile.

## Phase 1 — Local terminal

Dependencies: Phase 0.

- [x] **F07 — Local shell:** xterm.js connected to an owned node-pty session, executable shell discovery and configured override, bounded streamed output with acknowledgements, initial input/resize/exit/close support, and persistence across navigation. Static/build/native-load checks passed on Linux x64; feature tests and interactive runtime verification pending.
- [x] **F08 — Platform defaults:** Valid Unix login-shell preference, Bash-first Linux and Zsh-first macOS fallback; PowerShell 7/Windows PowerShell before cmd on Windows. Override availability is validated before save and at launch; specific missing/invalid-shell failures are shown without exposing raw exceptions. Static/build checks passed; tests written, not executed; platform runtime checks pending.
- [x] **F09 — Input and output:** Unicode 11 width handling, surrogate-safe bounded text input, validated binary terminal input, raw VT/control output streaming, terminal-friendly native accelerators, and composition/AltGr-safe navigation. Build/static checks pass; tests written and deferred; interactive/IME/platform verification pending.
- [x] **F10 — Resizing:** One renderer sizing controller measures, clamps, and applies the same grid to xterm and the PTY. Frame-coalesced layout/font/scale updates, hidden-workspace handling, startup resize retention and duplicate suppression are implemented. Static/build checks pass; tests written and deferred; native/visual verification pending.
- [x] **F11 — Tabs:** Independent PTYs and mounted terminal panes with create, rename, drag/button/keyboard reorder, switch, status and close actions. Running/starting tab closure names the tab in a confirmation. UI and backend enforce 16 terminals. Build/static checks pass; tests written, deferred; runtime/visual verification pending.
- [x] **F12 — Clipboard:** xterm selection/copy/select-all controls, plain-text paste via toolbar and native copy/paste events, bounded validated clipboard IPC, newline/control-character preview and confirmation, session-bound paste cancellation, and OSC 52 blocking. Static/build checks pass; tests written, deferred; native clipboard/keyboard verification pending.
- [x] **F13 — Search and scrollback:** Per-tab literal search with case option, match navigation, capped highlights and counts; 3,000-line scrollback and return-to-bottom control. Static/build checks pass; tests written and deferred; interactive verification pending.
- [x] **F14 — Appearance:** Per-tab theme, font, size, zoom, cursor shape and blink controls with reset and synchronized resizing. Settings remain in memory for the app session. Static/build checks pass; tests and visual/platform verification pending.
- [ ] **F15 — Session lifecycle:** Shell exit, process cleanup, and orphan prevention.
- [ ] **F16 — Performance:** Batched rendering and backpressure under heavy output.

Completion criteria: Verify interactive programs, resizing, Unicode, heavy output, keyboard behavior, and process cleanup on each supported operating system. Include Vim, tmux where available, and interactive prompts in compatibility checks.

## Phase 2 — Saved hosts and SSH

Dependencies: Phases 0–1. Prompt for secrets until secure storage is implemented.

- [ ] **F17 — Saved hosts:** Addresses, ports, usernames, labels, and protocol settings.
- [ ] **F18 — Groups and tags:** Nesting, search, filtering, inheritance, and overrides.
- [ ] **F19 — SSH sessions:** Connect remote shell channels to the terminal.
- [ ] **F20 — Authentication:** Passwords, private keys, passphrases, and keyboard-interactive prompts.
- [ ] **F21 — Known hosts:** Trusted fingerprints, unknown-key confirmation, and changed-key handling.
- [ ] **F22 — Connection state:** Connecting, authenticating, connected, disconnected, and failed.
- [ ] **F23 — Keepalive and reconnect:** Detect connection loss and allow explicit reconnection.
- [ ] **F24 — Cancellation:** Cancel pending connections and release resources.

Completion criteria: Test valid/invalid credentials, changed fingerprints, disconnects, cancellation, and remote terminal resizing against disposable servers. Reconnection must not silently repeat previous commands.

## Phase 3 — Credentials and local vault

Dependencies: Phase 2. Required before releasing persistent passwords or private-key storage.

- [ ] **F25 — Reusable identities:** Reference credentials from hosts and groups without duplicating secrets.
- [ ] **F26 — Secret storage:** Store secret material securely and separately from ordinary records.
- [ ] **F27 — SSH keys:** Import/generate supported keys and manage passphrases.
- [ ] **F28 — Public-key installation:** Explicit key and destination confirmation.
- [ ] **F29 — Lock and unlock:** Vault access, inactivity behavior, and restart behavior.
- [ ] **F30 — Backup and export:** Versioned import/export with explicit secret handling.
- [ ] **F31 — Recovery:** Missing keychain, forgotten password, and corrupted storage.

Completion criteria: No secrets leak into logs, ordinary database records, or default exports. Minimize secret exposure to the renderer. Unavailable secure storage must never silently fall back to plaintext. Verify restoration and migration failure recovery.

## Phase 4 — SFTP file manager

Dependencies: Phase 3 and the SSH connection layer.

- [ ] **F32 — File browser:** Local/remote panes, navigation, hidden files, sorting, and metadata.
- [ ] **F33 — File operations:** Directories, rename, deletion, and permitted attribute changes.
- [ ] **F34 — Transfers:** Queue, upload/download progress, cancellation, and failure reporting.
- [ ] **F35 — Overwrites:** Replace/skip decisions and validated destination paths.
- [ ] **F36 — Remote editing:** Temporary download, editor integration, change detection, and deliberate upload.
- [ ] **F37 — Recovery:** Interrupted transfers, partial-file cleanup, and verified resume support.

Completion criteria: Test permissions, interruptions, large files, symlinks, unusual filenames, overwrites, and partial transfers. Preserve originals during replacement where supported. SFTP does not automatically provide elevated permissions.

## Phase 5 — Workspaces and productivity

Dependencies: Stable sessions, storage, and credential handling.

- [ ] **F38 — Split panes:** Resizing, focus shortcuts, and independent sessions.
- [ ] **F39 — Workspace templates:** Saved layouts and deliberate reconnection.
- [ ] **F40 — Snippets:** Save, organize, search, and execute commands.
- [ ] **F41 — Startup snippets:** Assigned connection-time actions with visible execution.
- [ ] **F42 — Multiple-host execution:** Destination selection and per-host results/failures.
- [ ] **F43 — Broadcast input:** Explicit mode, visible recipients, and immediate stop.
- [ ] **F44 — Command history:** Search and sensitive-entry handling.
- [ ] **F45 — Environment variables:** Host/group values and server-support requirements.
- [ ] **F46 — Shell integration:** Supported working-directory and command-state detection.
- [ ] **F47 — Autocomplete:** History/snippets first, paths and arguments later.
- [ ] **F48 — Session logs:** Recording, bookmarks, comments, retention, and deletion.

Completion criteria: Workspace restoration does not silently repeat destructive commands. Broadcast destinations remain visible. Verify log limits and deletion, including sensitive-output handling. Unsupported shell integration must degrade gracefully.

## Phase 6 — Advanced connections and authentication

Dependencies: Stable SSH and session lifecycle. Prototype each adapter before selecting its implementation.

- [ ] **F49 — Port forwarding:** Local, remote, and dynamic forwarding with start/stop/status.
- [ ] **F50 — Jump hosts:** Connection chains, per-hop authentication, and cleanup.
- [ ] **F51 — Proxies:** SOCKS/HTTP routing for supported connection types.
- [ ] **F52 — SSH agents:** Supported agent discovery and explicit forwarding.
- [ ] **F53 — SSH certificates:** Formats, algorithms, expiry, and interoperability.
- [ ] **F54 — Hardware and biometric keys:** Platform integration and physical-device verification.
- [ ] **F55 — Serial:** Port discovery, configuration, permissions, and disconnect handling.
- [ ] **F56 — Telnet:** Separate protocol adapter and clear connection properties.
- [ ] **F57 — Mosh:** Client integration, server requirements, and packaging investigation.
- [ ] **F58 — Cryptography:** Supported library algorithms and compatibility checks.

Completion criteria: Publish prerequisites and platform support. Test tunnel conflicts, denied forwarding, multi-hop failures, hardware access, and unsupported algorithms. Do not implement custom cryptographic primitives.

## Phase 7 — Accounts and encrypted synchronization

Dependencies: Stable data model, secure storage, migrations, and key-management design. Introduces the online backend.

- [ ] **F59 — Accounts:** Registration, verification, sign-in, devices, and sessions.
- [ ] **F60 — Account protection:** MFA, rate limiting, recovery, and session revocation.
- [ ] **F61 — Encrypted sync:** Client-side encryption, key management, and versioned payloads.
- [ ] **F62 — Offline editing:** Queued changes and reconnection synchronization.
- [ ] **F63 — Conflicts:** Concurrent edits, deletions, stale devices, and version compatibility.
- [ ] **F64 — Sync preferences:** Independent handling of credentials and metadata.
- [ ] **F65 — Device identity:** Optional public-key directory and device lifecycle.

Completion criteria: Define behavior for device loss, conflicting changes, offline deletion, key rotation, recovery, and revoked devices. Preserve unsynced changes. Obtain security review before claiming end-to-end encryption.

Removing a directory entry does not revoke public keys already installed on remote servers.

## Phase 8 — Teams and collaboration

Dependencies: Phase 7 with reviewed authorization and encryption boundaries.

- [ ] **F66 — Organizations:** Invitations, membership, ownership, and offboarding.
- [ ] **F67 — Shared vaults:** Hosts, identities, snippets, and settings.
- [ ] **F68 — Permissions:** Multiple vaults and server-enforced authorization.
- [ ] **F69 — Shared logs:** Access controls, retention, bookmarks, and comments.
- [ ] **F70 — Multiplayer:** Authorized invitations, encrypted relay, typing ownership, and revocation.
- [ ] **F71 — Administrative events:** Membership, permissions, and vault-management records.

Completion criteria: Verify authorization through both UI and API. Revocation stops future sync and live-session access. Server-side credential revocation remains a separate offboarding responsibility.

## Phase 9 — AI integrations and commercial features

Dependencies: Relevant desktop capabilities and online services. Schedule individual features after their own prerequisites are met.

- [ ] **F72 — AI assistance:** Command/snippet generation, context controls, quotas, and review before execution.
- [ ] **F73 — Cloud inventory:** AWS, Azure, and DigitalOcean adapters with least-privilege credentials.
- [ ] **F74 — Automation:** Documented API contract and Ansible integration.
- [ ] **F75 — Enterprise identity:** SAML SSO, domain controls, and provisioning workflows.
- [ ] **F76 — Compliance integrations:** Evidence exports and explicit external contracts.
- [ ] **F77 — Billing:** Subscriptions, seats, payment webhooks, and entitlements.
- [ ] **F78 — Enterprise operations:** Retention, support, onboarding, and contractual requirements.

Completion criteria: Retries cannot duplicate inventory or incorrectly grant entitlements. Define AI data boundaries. SSO must not bypass vault encryption. Compliance claims and SLAs require operational evidence.

Termius integration names do not provide implementation specifications for this application. Define actual behavior before development. Its cloud-integration plan descriptions conflict between pricing and implementation guides; do not carry this ambiguity into this application's feature policy.

## Release engineering

Start during Phase 0 and revisit for every public release.

- [ ] Linux, Windows, and macOS build/smoke checks.
- [ ] Document supported OS versions and CPU architectures.
- [ ] Package native dependencies for Electron and each target architecture.
- [ ] Verify installers, signing, and notarization where applicable.
- [ ] Verify update authenticity and migration failure recovery.
- [ ] Test keyboard navigation, focus, labels, contrast, and accessibility.
- [ ] Check display scaling, Unicode, shell paths, and platform shortcuts.
- [ ] Test crashes and closing with active sessions, transfers, or unsynced changes.
- [ ] Measure startup, idle resources, heavy output, and concurrent sessions.
- [ ] Document installation, development, testing, and troubleshooting.
- [ ] Review dependency licenses, security updates, and release contents.

## Definition of verified completion

Implementation checkboxes track delivered code, as requested; they do not replace the phase verification gate. Before declaring a phase verified, confirm for its features that:

1. Intended behavior is implemented.
2. Relevant success and failure paths are verified.
3. Resources and data are cleaned up safely.
4. Errors explain what happened and what the user can do.
5. Material limits are documented.
6. Validation evidence identifies the operating systems checked.

## Active work

| Feature | Status | Issue/PR | Verification | Blocker/next action |
| --- | --- | --- | --- | --- |
| F01/F02 | Implementation complete | `apps/desktop/src/main/`, `apps/desktop/src/preload/` | Static/build checks passed; Ubuntu launch reported by user | Security unit tests pass; sandbox-enabled desktop lifecycle and Windows/macOS checks pending |
| F03 | Implementation complete | `apps/desktop/src/renderer/src/` | Static/build checks passed; E2E smoke run found reload/navigation-test issues; fixes added with reload-policy unit tests | Visual review and phase tests pending |
| F04 | Implementation complete | `apps/desktop/src/main/preferences.ts` | Static/build and preference unit tests pass | Runtime/visual verification pending |
| F05 | Implementation complete | `apps/desktop/src/main/storage/database.ts` | Build/type/lint/format and storage unit tests pass | Runtime recovery/platform checks pending |
| F06 | Implementation complete | `apps/desktop/src/main/diagnostics.ts`, `apps/desktop/src/shared/failures.ts` | 37 total unit tests pass; build/type/lint/format pass | Sandbox-enabled desktop tests blocked; Phase 0 verification remains incomplete |

| F07 | Implementation complete | `apps/desktop/src/main/terminal/`, `apps/desktop/src/renderer/src/features/workspace/` | Build/static checks and Electron native-module load pass on Linux x64; tests written, not executed | Interactive shell/visual checks pending; F08 next |

| F08 | Implementation complete | `apps/desktop/src/main/terminal/shells.ts` | Type/lint/format/build pass; policy/availability and invalid-override E2E tests written, not run | Linux/macOS/Windows runtime verification pending; F09 next |

| F09 | Implementation complete | `apps/desktop/src/shared/terminal-input.ts`, `apps/desktop/src/main/menus.ts` | Type/lint/format/build/diff pass; transport/menu/keyboard tests written, not run | Interactive/IME/Windows/macOS verification pending; F10 next |

| F10 | Implementation complete | `apps/desktop/src/renderer/src/features/workspace/terminal-sizing.ts`, `apps/desktop/src/main/terminal/session.ts` | Type/lint/format/build/diff pass; sizing, startup-race and PTY/DSR E2E checks written, not run | Native display/full-screen/platform verification pending; F11 next |

| F11 | Implementation complete | `apps/desktop/src/main/terminal/registry.ts`, `apps/desktop/src/renderer/src/features/workspace/` | Type/lint/format/build/diff pass; registry/tab/E2E regressions written, not run | Visual, native focus/drag and multi-process verification pending; F12 next |

| F12 | Implementation complete | `apps/desktop/src/main/clipboard.ts`, `apps/desktop/src/renderer/src/features/workspace/use-terminal-clipboard.ts` | Type/lint/format/build/diff pass; policy/IPC and desktop paste regressions written, not run | Native OS clipboard/keyboard/visual checks pending; F13 next |

## Progress log

Append entries for completed work and material decisions.

| Date | Features | Change/decision | Evidence and remaining limits |
| --- | --- | --- | --- |
| 2026-10-28 | F01–F78 | Initial development roadmap saved | Planning only; application behavior not verified |
| 2026-10-28 | Foundation | Selected Electron/TypeScript stack; documented source layout and Git ignore rules | Application implementation has not started |
| 2026-10-28 | F03 | Recorded Termius Desktop as the required UI reference in README.md | Design requirements only; no interface implemented yet |
| 2026-10-28 | Foundation | Established monorepo directory placeholders and updated nested output ignore rules | Desktop, server, and shared package implementation has not started |
| 2026-10-28 | F01/F02 | Added npm workspace/toolchain, secure desktop window lifecycle, app-info bridge, welcome screen, and security/startup tests | Build/type/lint/format checks passed. Tests intentionally not run. Ubuntu sandbox blocks desktop launch; visual and Windows/macOS verification pending. Features remain unchecked until verification. |
| 2026-10-28 | F01/F02 | User reported Ubuntu launch succeeds; marked implementation delivered using the updated tracking convention | User-reported startup only; no automated security/lifecycle test pass implied. Earlier sandbox failure remains historical agent-side evidence. |
| 2026-10-28 | F03 | Implemented Termius-style navigation, view tabs, Hosts search/empty states, Workspace empty state, read-only Settings, and status bar; next step is F04 | Build/type/lint/format checks passed. E2E coverage updated but not executed. No visual inspection surface available; Phase 0 remains unverified. |

## References

These references informed the plan. Check current dependency versions and behavior when implementing a feature.

- [Termius features](https://www.termius.com/pricing)
- [Termius documentation](https://docs.termius.com/)
- [Electron](https://www.electronjs.org/docs/latest/)
- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security)
- [xterm.js](https://xtermjs.org/)
- [node-pty](https://github.com/microsoft/node-pty)
- [ssh2](https://github.com/mscdex/ssh2)

### F04 implementation update

Settings are versioned in `preferences.json` under Electron userData. Validated IPC and queued temporary-file replacement protect writes. Invalid existing files are preserved and startup fails rather than overwriting them. Navigation shortcuts use Ctrl+Alt+1/2/3. Window position and arbitrary shortcut remapping are outside this initial preference scope. F05 is next; phase tests remain deferred.

### F05 implementation update

Added SQLite schema v1 with migration history and a stable local-workspace UUID. Startup initializes storage before opening the window and closes it at quit. Backups use SQLite’s snapshot API; recovery validates the staged database and preserves the replaced file. Offline maintenance commands and crash-lock recovery are documented in `docs/LOCAL_STORAGE.md`. No credentials are stored. Preferences remain in their F04 JSON file. Build/static checks pass; tests are written and deferred until Phase 0 completion. Electron SQLite runtime and Windows/macOS remain unverified. Next: F06.

### F06 implementation and Phase 0 test gate

Added fixed failure codes and recovery actions for database ownership/corruption,
invalid preferences, permissions, disk exhaustion, backup support, and interface
failures. Diagnostic logs contain timestamps and allowlisted codes only, rotate at
256 KiB with one previous file, and fail without exposing raw exceptions. Preference
write failures return sanitized results and retain the form. Desktop tests now use
isolated temporary profiles and explicitly enable Chromium sandboxing.

Validation on Linux / Node 24.12.0: 37/37 unit tests pass; type, lint, format,
production build, and diff checks pass. The initial Playwright run (its default
sandbox disabled) passed 6 tests and failed 3: it revealed blocked reloads, a test
listening after navigation was cancelled, and an ambiguous Appearance label. Those
issues were fixed, including reload-policy unit coverage. That smoke run is not a
sandbox security pass. The final sandbox-enabled run aborted on the first launch
because chrome-sandbox has invalid ownership/mode; 9 remaining tests did not run.
No security settings or system permissions were changed. Phase 0 implementation
is complete; desktop/visual and cross-platform verification remains incomplete.
See `docs/DIAGNOSTICS.md` for diagnostics and the outstanding test command.

### F07 implementation update

Started Phase 1 at the user's instruction while retaining the incomplete Phase 0
sandbox/visual gate. Workspace now starts one local PTY, streams output directly
into xterm.js, accepts input, resizes, and exposes explicit close/exit states.
Switching views keeps the terminal mounted. Window destruction, renderer failure,
and navigation reset dispose the PTY; cancellation also kills late-created PTYs.
Installed shell paths are discovered in the main process; a validated executable
path from Settings overrides discovery. There is no command-string interpolation
or renderer filesystem/process access. IPC validates the owning main frame,
session IDs, grid size, input length, and acknowledgements.

Output is batched every 16 ms with pause/resume watermarks and a 1 Mi-character
hard cap; xterm scrollback is capped at 3,000 lines. Overflow stops the session
explicitly. This initial protection does not complete F16 performance validation.
Initial resize/cleanup support does not complete F10/F15 compatibility testing.
F11 tabs and multiple sessions are not implemented.

Added exact dependencies and native rebuild hooks for Electron. Build, type,
lint, format, and diff checks pass. node-pty loads under Electron's bundled Node
24.22.1 / ABI 150 on Linux x64; no interactive shell, visual, or Windows/macOS pass
is claimed. New unit/E2E tests are written and type-checked but not executed until
the Phase 1 gate. F08 is next. Commit this step without pushing.

### F08 implementation update

Made shell selection deterministic per platform while respecting a valid Unix
`SHELL` preference. Linux falls back through Bash, Zsh, then sh; macOS through Zsh,
Bash, then sh. Windows checks PowerShell 7 in Program Files and absolute PATH
directories, then Windows PowerShell, ComSpec and cmd. Windows ignores Unix SHELL,
rejects drive-relative/root-relative paths and scripts, and deduplicates candidate
paths without case sensitivity. Automatic selection excludes false/nologin.

A nonempty saved override must name an existing, accessible executable; invalid
overrides never silently fall back. Validation occurs before saving and again at
launch, so deleting/moving the executable after saving produces a useful error.
Rejected saves retain previous preferences and the user's draft. Start results
now carry a fixed failure code through preload to Workspace; diagnostics record
codes only. No configuration schema or dependency changes were required.

Type checking, lint, formatting, build and diff checks pass. Tests are written and
type-checked but not executed until the Phase 1 gate. Runtime and Windows/macOS
verification remain pending; Phase 0's sandbox blocker remains recorded. Next:
F09. Commit as Phase 1 / F08 without pushing.

### F09 implementation update

Added a tagged text/binary input contract, validated at the main-process IPC
boundary. Text chunks preserve surrogate pairs at the 64 Ki-character boundary;
xterm binary events are converted to Latin-1 byte buffers rather than UTF-8
re-encoding. Existing output batches remain raw VT text, parsed by xterm across
writes; neither input nor output enters React state or diagnostic logs. Activated
the pinned Unicode 11 width provider through xterm's proposed Unicode API.

Moved native menu construction into a focused module. On Linux/Windows, conflicting
menu accelerators use Ctrl+Shift so shell Ctrl keys reach xterm; macOS retains
Command-based native roles. Reserved Ctrl+Alt+1/2/3 navigation is not also written
to the shell, and composition/AltGr input is not treated as navigation. Fixed the
bridge declaration import so NodeNext E2E type checking resolves the actual API.

Static/build/diff checks pass. Added transport, byte-preservation, Unicode boundary,
stream ordering, menu and composition tests plus a Bash desktop regression for
Unicode/ANSI output, Ctrl+W/Ctrl+R, and Ctrl+C interruption. Tests are written and
type-checked, not executed until Phase 1 completion. Native IME, font rendering,
modern grapheme clusters and Windows/macOS compatibility remain unverified.
Phase 0's sandbox blocker remains unchanged. Next: F10; commit without pushing.

### F10 implementation update

Replaced independent FitAddon.fit calls and separately clamped IPC sizes with one
sizing controller. It measures with proposeDimensions, applies the shared limits
to both grids, and coalesces notifications into animation frames. It ignores
hidden/zero-size or invalid measurements, suppresses unchanged publication, and
can force synchronization after a new PTY opens. Container/window resize, font
readiness/loading, device-pixel-ratio changes, and workspace activation request a
fit. Disposal removes observers/listeners and cancels pending frames.

The main session retains the latest resize while shell startup awaits filesystem
or native initialization, applies it to the created PTY, and ignores duplicate or
stale-session resizes. Pending openings use object identity so a late cancelled
process cannot attach to a newer opening reusing its ID. Grid bounds are shared
with IPC validation. No settings or dependency migration was required.

Type/lint/format/build/diff checks pass. New tests cover coalescing, exact grid
caps, hidden/invalid measurements, forced resync, disposal, startup races and
native resize deduplication. A Bash/stty E2E fixture compares PTY dimensions with
xterm's cursor-position report after window resizing and hidden-workspace restore.
Tests are written and type-checked but deferred until Phase 1 completion. Visual,
DPI/zoom, full-screen applications and Windows/macOS runtime checks remain pending.
Phase 0's sandbox blocker remains recorded. Next: F11; commit without pushing.

### F11 implementation update

Added a window-owned terminal registry around the existing single-session manager.
Each opaque session ID owns its own PTY, buffer, acknowledgements, dimensions and
cleanup; duplicate IDs cannot replace a live process. Closing/resetting/disposing
releases only the intended entries, including late-created processes after tab
cancellation. Exit/error events release backend slots. Both renderer and backend
are bounded to 16 tabs/sessions.

Workspace now creates local-shell tabs, keeps panes mounted across tab/view changes,
renames labels without restarting processes, reorders by drag/buttons/keyboard,
and switches via roving tabs. Arrow/Home/End navigate, F2 renames, Delete requests
close, and Alt+Shift+Left/Right reorder. Native modal dialogs confirm the named
running/starting tab and trap focus; app navigation cannot bypass an open dialog.
Closing an active tab selects a neighbor. Exited/error tabs retain output until
closed or explicitly restarted. Names/order are in memory; app reload still ends
sessions and does not restore them. No saved-workspace persistence is claimed.

Type/lint/format/build/diff checks pass. Tests cover reducer actions and boundaries,
backend isolation/limits/cleanup, tab creation/output isolation, rename/reorder,
keyboard focus and close confirmation. Existing close-session regression was
updated for confirmation. Test code is written and type-checked but not executed
until Phase 1 completion. Native multi-process, focus, drag, visual and platform
checks remain pending, alongside Phase 0's sandbox verification. Next: F12;
commit without pushing.

### F12 implementation update

Added plain-text OS clipboard operations through a narrow main-process API using
Electron's asynchronous readText/writeText methods. Requests validate the owning
main frame and focused window; reads revalidate after awaiting the OS. Transfers
are limited to 1 Mi UTF-16 units, and failures expose fixed codes only. Diagnostic
logs never contain clipboard payloads or previews.

Each pane now offers Copy selection, Paste and Select all. Native copy/cut/paste
events are intercepted within the terminal container, leaving other app inputs
unchanged. Copy uses only the xterm selection; cut copies without deleting output.
Paste normalizes CRLF/CR and uses xterm.paste to honor bracketed-paste mode.
Newlines (including trailing newlines) and control characters require a modal
preview naming the target tab. Control characters are displayed as escapes and
previews are bounded to 8 Ki source units. Cancel sends nothing. Confirmation
checks the exact captured terminal instance/session and visibility/readiness;
an ended/replaced/hidden target cannot receive the text. OSC 52 is consumed
without clipboard access. No raw clipboard content is persisted by the app.

Static/build/diff checks pass. New tests cover Unicode/newline/control previews,
limits, IPC owner/focus checks, async focus loss and sanitized errors, copy and
multiline cancel/confirm, native paste interception and exited-target rejection.
Desktop fixtures stub clipboard IO or synthesize ClipboardEvents rather than read
or replace the user's actual OS clipboard. Tests are written/type-checked but not
executed until Phase 1 completion. Native keyboard, OS clipboard, focus, visual
and Windows/macOS verification remain pending; Phase 0's sandbox blocker remains.
Next: F13; commit without pushing.

### F13 implementation update

Added per-tab xterm search with case matching, previous/next navigation, keyboard shortcuts, capped match highlights and a return-to-bottom action. Search is limited to 256 UTF-16 units and the existing 3,000-line scrollback; queries and output are not persisted. Build, type, lint, format and diff checks pass. Unit and desktop tests are written and type-checked but not run until the Phase 1 gate. Visual and cross-platform verification remain pending. Next: F14.

### F14 implementation update

Added per-tab terminal appearance controls and a reset action. Theme can follow the app or use dark/light; font family, size, zoom, cursor shape and blink are independently configurable. Font changes request a fresh PTY fit. Choices remain in memory for the app session and are not persisted. Unit and desktop tests are written but deferred until the Phase 1 gate. Static/build checks pass; native visual and platform checks remain pending. Next: F15.


### F15 implementation in progress

Closing a tab or resetting its owner now cancels an in-progress shell start before
spawn; any process returned by a non-cancellable factory is still terminated.
Closing a window with active or starting sessions asks for confirmation, and new
sessions are blocked while window state is saved. Cancel or a failed save leaves
the window usable. Existing exit handling retains terminal output.

Orphan prevention remains incomplete: node-pty signals the shell, but does not
guarantee termination of detached or independently managed descendants. Platform-
specific process-tree handling and Linux, macOS and Windows verification are
still needed before F15 can be checked off. Focused unit and desktop tests are
written but deferred until the Phase 1 test gate.


### F15 PTY cleanup update

On tab close, failed setup, reset, overflow, or a late cancelled start, the
app now closes the PTY through node-pty's runtime `destroy()` method. On Unix
this closes the terminal device as well as signaling the shell, so ordinary
foreground jobs can receive a hangup. Windows uses node-pty's console cleanup.
If destruction is unavailable or fails, the public `kill()` API is attempted.
The dependency is pinned to node-pty 1.1.0; its runtime `destroy()` is omitted
from the public TypeScript declarations and must be rechecked on upgrade.

This is best-effort cleanup, not a guarantee for detached processes or jobs that
ignore hangup. F15 remains open until cleanup is validated on Linux, macOS, and
Windows and the remaining orphan-prevention scope is resolved. A Unix foreground
job desktop test and unit tests are written but not run before the Phase 1 test
gate. Build, type, lint, and formatting checks pass.
