# Terminal Development Roadmap

Created: 2026-10-28  
Target platforms: Ubuntu/Linux, Windows, and macOS  
Scope: A Termius-style desktop terminal and infrastructure client  
Excluded: Mobile applications

This is a proposed development plan based on public capabilities, not a claim of exact Termius parity or a description of its private implementation. Validate dependency compatibility, platform support, and security boundaries during implementation.

## Development tracking

- Unchecked means implementation is planned or incomplete; checked means the implementation step is delivered. Phase verification is tracked separately: a checked feature does not mean its deferred tests or all platform checks have passed.
- Keep feature IDs stable and reference them in commits, issues, and pull requests.
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
| Active feature | F04 implementation delivered; Phase 0 remains in progress |
| Next feature | F05 — Local database |
| Implementation status | F01–F04 implemented: desktop foundation, restricted bridge, navigation, Hosts/Workspace/Settings views; phase verification pending |
| Runtime evidence | User reported the application opens on Ubuntu; automated security and F03 visual verification remain pending |
| Current blocker | No user-reported startup blocker; agent-side visual inspection unavailable |
| Phase 0 verification | Unit/E2E tests written and type-checked, intentionally not executed until the phase implementation is complete |
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
- [x] **F04 — Preferences:** Persisted dark/light appearance, navigation shortcut toggle, default-shell path, and window size/maximized state. Shell selection is stored for F07/F08; executable discovery and validation remain there. Runtime and phase tests pending.
- [ ] **F05 — Local database:** Migrations, transactions, stable IDs, and recoverable backups.
- [ ] **F06 — Error handling:** Useful messages and diagnostic logs without secrets.

Completion criteria: The application opens reliably, persists preferences, handles failures, and rejects invalid IPC requests. Keep process execution, filesystem access, and credentials outside the renderer.

UI acceptance: Compare the application shell and host view visually with Termius Desktop. Verify consistent dark styling, compact spacing, accessible contrast, keyboard focus, resizing, and platform-appropriate window controls. Use mTerminal branding. Terminal tabs, split panes, and SFTP follow their respective feature phases.

Document source layout, runtime versions, entry points, dependency installation, development, build, lint, and test commands in `README.md`. Configure formatting/linting and a suitable test framework with the first implementation, and commit the dependency lockfile.

## Phase 1 — Local terminal

Dependencies: Phase 0.

- [ ] **F07 — Local shell:** Connect xterm.js to node-pty and discover installed shells.
- [ ] **F08 — Platform defaults:** Bash/Zsh on Unix systems, PowerShell on Windows, and a configurable override.
- [ ] **F09 — Input and output:** Unicode, control sequences, keyboard input, and streamed output.
- [ ] **F10 — Resizing:** Synchronize terminal rows/columns with the PTY.
- [ ] **F11 — Tabs:** Create, rename, reorder, switch, and close.
- [ ] **F12 — Clipboard:** Selection, copy/paste, shortcuts, and multiline-paste handling.
- [ ] **F13 — Search and scrollback:** Searchable output and bounded history.
- [ ] **F14 — Appearance:** Themes, fonts, cursor, zoom, and per-session settings.
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
| F01/F02 | Implementation complete | `apps/desktop/src/main/`, `apps/desktop/src/preload/` | Static/build checks passed; Ubuntu launch reported by user | Run lifecycle/security tests at the Phase 0 gate; Windows/macOS unverified |
| F03 | Implementation complete | `apps/desktop/src/renderer/src/` | Static/build checks passed; navigation/search/keyboard/minimum-size E2E checks written but not executed | Visual review and phase tests pending |
| F04 | Implementation complete | `apps/desktop/src/main/preferences.ts` | Static checks/build; focused tests written, execution deferred | Runtime/visual verification pending |
| F05 | Next | — | Not started | SQLite migrations, transactions, stable IDs, recoverable backups |

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
