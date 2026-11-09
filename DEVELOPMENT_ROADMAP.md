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
| Current milestone | M2 — Secure credentials and SFTP |
| Active feature | F42 implemented — Reviewed execution on connected SSH accounts with bounded per-host results; acceptance pending |
| Next feature | F43 — Broadcast input; Phase 4/5 runtime verification remains deferred |
| Implementation status | F01–F31 implemented: desktop foundation, restricted bridge, navigation, Hosts/Workspace/Settings views, preferences, SQLite foundation, actionable failures, safe diagnostics, owned local PTY sessions, platform shell defaults, Unicode/text/binary terminal input/output, synchronized resizing, independent terminal tabs, clipboard controls, search, appearance, lifecycle cleanup, bounded output batching, saved SSH profiles, nested groups, defaults, tags, SSH terminal sessions, password/key/interactive authentication, saved host-key trust, explicit SSH connection states, keepalive, explicit reconnect, in-place SSH cancellation, reusable identities, encrypted password/private-key vault storage, confirmed SFTP public-key installation, passphrase-protected vault lock/unlock, versioned workspace backup/import, and vault/database recovery guidance; Phase 3 unit gate passed, E2E launch blocked |
| Runtime evidence | User reported the application opens on Ubuntu; automated security and F03 visual verification remain pending |
| Current blocker | Sandbox-enabled E2E launch aborts: chrome-sandbox ownership/mode is invalid in this environment; no OS permissions changed |
| Phase 0 verification | 37/37 unit tests passed on Linux/Node 24.12.0; static/build checks pass. Sandbox-enabled E2E: first launch blocked, remaining 9 not run (fail-fast). Visual and Windows/macOS verification pending |
| Last roadmap update | 2026-11-09 |

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
- [x] **F15 — Session lifecycle (implementation):** Shell exit, startup cancellation, close confirmation, and best-effort PTY/process cleanup. Detached or signal-ignoring descendants can survive; cross-platform verification remains pending.
- [x] **F16 — Performance (implementation):** Bounded 64 Ki UTF-16-unit batches scheduled every 16 ms, renderer acknowledgements, high/low-water backpressure, and a 1 Mi-unit pending-output limit. Unit tests pass; desktop workload verification blocked.

Completion criteria: Verify interactive programs, resizing, Unicode, heavy output, keyboard behavior, and process cleanup on each supported operating system. Include Vim, tmux where available, and interactive prompts in compatibility checks.

## Phase 2 — Saved hosts and SSH

Dependencies: Phases 0–1. Prompt for secrets until secure storage is implemented.

- [x] **F17 — Saved hosts (implementation):** Create/edit/delete SSH profiles with names, addresses, ports and usernames; searchable host list, confirmation before deletion, schema v2 persistence and validated IPC. Tests written and deferred to the Phase 2 gate; visual/runtime verification pending.
- [x] **F18 — Groups and tags (implementation):** Nested groups with port/username defaults, field-level inheritance and host overrides, normalized tags, descendant-aware group and exact tag filtering, and search across profile, effective username, group and tags. Tests written; Phase 2 execution and runtime verification pending.
- [x] **F19 — SSH sessions (implementation):** Saved-host Connect opens a remote PTY through ssh2 with session-only password and explicitly pinned SHA256 fingerprint, input/output, resizing, backpressure, cancellation and cleanup. Tests written; execution deferred to Phase 2 gate.
- [x] **F20 — Authentication (implementation):** Session-only passwords, selected private-key files with optional passphrases, multi-round keyboard-interactive prompts and optional challenge continuation after password/key authentication. Bounded, session/token-scoped replies; cancellation and expiry. Tests written; execution deferred to Phase 2 gate.
- [x] **F21 — Known hosts (implementation):** Persistent endpoint fingerprints, unknown-key confirmation, changed-key refusal with both fingerprints, explicit checked rotation followed by a new connection, optional pinning and cancellation. Tests written; execution deferred to Phase 2 gate.
- [x] **F22 — Connection state (implementation):** Main-owned connecting, identity verification, authenticating, opening-shell and connected progress; disconnected/failed outcomes, retained terminal output, active-session counts and close guards. Tests written; execution deferred to Phase 2 gate.
- [x] **F23 — Keepalive and reconnect (implementation):** SSH keepalive probes, a specific lost-peer failure message, and explicit reconnect with new session IDs, fresh credentials, profile/trust re-evaluation and no command replay. Tests written; execution deferred to Phase 2 gate.
- [x] **F24 — Cancellation (implementation):** In-place cancellation during setup, identity checks and interactive authentication; retained tab/output, socket/timer/challenge cleanup and stale callback suppression. Phase 2 unit gate: 113/113 passed; desktop acceptance blocked.

Completion criteria: Test valid/invalid credentials, changed fingerprints, disconnects, cancellation, and remote terminal resizing against disposable servers. Reconnection must not silently repeat previous commands.

## Phase 3 — Credentials and local vault

Dependencies: Phase 2. Required before releasing persistent passwords or private-key storage.

- [x] **F25 — Reusable identities (implementation):** Reusable local SSH identity profiles hold a display name, username and preferred authentication method. Hosts can override group identity defaults; nested groups inherit the nearest assignment. Deleting an identity clears references safely. Profiles contain no secret material. Tests written; Phase 3 gate deferred.
- [x] **F26 — Secret storage (implementation):** Opt-in SSH passwords are encrypted through Electron safeStorage and stored as separate, permission-restricted ciphertext files. Passwords are decrypted only in the main process for authentication. Linux `basic_text` and unavailable keychain backends are refused. Tests written; Phase 3 gate deferred.
  - [x] **F26-A — Remembered host login (fix):** First-prompt missing usernames can be saved to the same host without replacing configured defaults; saved-password references use the resolved password owner. Credential lookup/submission/cancel guards added. Existing encrypted vault and one-click lookup reused. Regression code written; tests unrun at the user's request.
  - [x] **F26-B — Complete host login:** One explicit save checkbox stores an encrypted username/password pair per host; unchecked uses entered credentials once. Vault setup/unlock is available in the connection flow. Saved pairs override defaults without rewriting profiles/shared identities; legacy passwords remain supported. Regression code updated; execution deferred.
- [x] **F27 — SSH keys (implementation):** Import supported OpenSSH/RFC4716/PPK private keys, generate Ed25519 keys or passphrase-protected RSA 2048 keys, store key/passphrase ciphertext through OS secure storage, and use a managed key only with its assigned identity. The identity manager exposes the public key for copying. Tests written; Phase 3 gate deferred.
- [x] **F28 — Public-key installation (implementation):** Install the assigned identity's managed public key to a confirmed host/account using SFTP, after the host fingerprint has been trusted. Preserve existing `authorized_keys` entries, avoid duplicates, and enforce `.ssh`/file permissions. Authentication uses the identity's saved password or a one-time password. Tests written; Phase 3 gate deferred.
- [x] **F29 — Lock and unlock (implementation):** Add a vault passphrase that wraps the vault key, migrate existing encrypted credential files, lock on restart and after five idle minutes, and gate saved-credential access while locked. Tests written; Phase 3 gate deferred.
- [x] **F30 — Backup and export (implementation):** Export versioned workspace JSON without secrets; validate and merge imports transactionally, rejecting conflicts without overwriting records. Tests written; Phase 3 gate deferred.
- [x] **F31 — Recovery (implementation):** Document keychain/database recovery and add a confirmed vault reset that preserves encrypted files in a recovery folder while allowing a new vault. Phase 3 unit gate passed; E2E launch blocked by the host environment.

Completion criteria: No secrets leak into logs, ordinary database records, or default exports. Minimize secret exposure to the renderer. Unavailable secure storage must never silently fall back to plaintext. Verify restoration and migration failure recovery.

## Phase 4 — SFTP file manager

The user requested command history before continuing Phase 4. F32 resumes after the local
history feature. Existing F32–F78 IDs and ordering are unchanged.

### Command history addition (CH)

- [x] **CH01 — Command capture:** Opt-in temporary Bash 5+ prompt integration; preserve user dotfiles, consume bounded session-tagged recording frames in the main process, and skip unsupported shells.
- [x] **CH02 — Encrypted history:** Use vault/OS encryption, 500-entry and size limits, 30-day expiry, deduplication, directory ranking, and deletion; exclude history from default exports.
- [x] **CH03 — History sidebar:** Collapsible right-side panel with History/Autocomplete tabs, prefix search, click-to-insert without executing, copy/delete actions, recording controls, and per-tab integration status.
- [x] **CH04 — Autocomplete dropdown:** Show up to five matching commands beneath the cursor with highlighted prefixes, Up/Down selection, Right Arrow/click insertion, Escape dismissal, and per-tab enable control. Preserve Tab completion and separate Enter execution; clamp the popup inside narrow/bottom-edge terminals.
- [ ] **CH05 — Additional shell support:** Zsh, PowerShell, and explicitly enabled remote SSH integration; schedule after the original roadmap resumes.

Validation: all 144 unit tests passed on Linux, including real Bash capture, split/token-checked
protocol frames, encryption, deduplication, locking, deletion, and reset preservation. Typecheck,
lint, formatting, production build, and diff checks passed. Interactive suggestion placement and
keyboard behavior, Electron E2E, and Windows/macOS remain unverified.
Setup, architecture, privacy, and supported-shell limits: `docs/COMMAND_HISTORY.md`.

History follow-up: refresh history/suggestions after successful saves and expose per-tab
integration status. A real Linux PTY probe confirmed command/prompt frames. Four focused tests
cover capture/storage and persistence-success/error notifications; interactive UI verification
remains outstanding. The sidebar/dropdown redesign follows the supplied reference images;
six focused tests pass for matching, popup bounds, capture/storage, and save notifications.

CH02–CH04 review fixes: recording defaults to off for new and older settings without an
explicit recording preference; existing explicit choices are preserved. Native Bash history
preserves timestamp-delimited multiline commands as single items (copy only), drops ambiguous
text before the first timestamp, and treats file-open failures as an unavailable native source
without blocking saved history. Untimestamped files still assume one command per line.
All 13 focused history, autocomplete, IPC, and preference tests passed. Static checks passed;
interactive Electron validation remains pending.

Dependencies: Phase 3 and the SSH connection layer.

- [x] **F32 — File browser (implementation):** Read-only local/remote panes within terminal tabs, canonical paths, breadcrumbs, home/up/refresh navigation, hidden files, sorting, and metadata. Reuse the verified SSH connection; bound directory listings and clean up SFTP handles/channels. Tests written and deferred to the Phase 4 gate; desktop/platform acceptance pending. See `docs/FILE_BROWSER.md`.
  - [x] **F32-A — File-browser design (implementation):** Compact pane-level Filter/Actions and selected-file transfer controls; on-demand path editor, bounded Back/Forward history, filename filtering, sortable Name/Date Modified/Size/Kind columns, symbolic permissions under names, keyboard selection and folder navigation, and compact queue/recovery/editor panels. Existing transfers and confirmations reused. Tests written but unrun; browser unavailable for visual inspection.
- [x] **F33 — File operations (implementation):** Single-folder creation, same-directory rename with destination protection, confirmed file/link/empty-folder deletion, and permitted octal mode changes. No recursive deletion, elevation, or chmod of symlinks/special files. Refresh after each attempt, preserve partial/uncertain outcomes, and reject stale SSH-connection confirmations. Tests written; Phase 4 execution and desktop/platform acceptance deferred. See `docs/FILE_BROWSER.md`.
- [x] **F34 — Transfers (implementation):** Window-owned, bounded single-file upload/download queue on verified SSH sessions, progress, queued/active cancellation, sanitized failure and cleanup-path reporting, destination refresh, and non-overwriting staged publication. Regular files only; no replay or resume. Tests written and deferred to the Phase 4 gate; live-server, visual, and platform acceptance pending. See `docs/FILE_BROWSER.md`.
  - [x] **F34-A — Transfer interaction (implementation):** Drag one regular file between Local/Remote panes into the open target folder, then explicitly confirm Add to queue. Visible Upload/Download buttons and file-row right-click actions improve discovery. Same-pane, external, non-file and stale-context drops are refused. Regression tests written; execution and visual/live/platform acceptance deferred.
- [x] **F35 — Overwrites (implementation):** Source/destination metadata preview, token-bound Replace/Skip/Cancel decisions with Skip as default, canonical path/version checks, staged replacement with retained original backups, guarded restore, and uncertain-outcome reporting. Non-file destinations are refused. Tests written; Phase 4 execution and desktop/platform acceptance remain pending. See `docs/FILE_BROWSER.md`.
- [x] **F36 — Remote editing (implementation):** One regular UTF-8 file up to 1 MiB per window; private `.txt` working copy in the OS default text editor, saved-byte change detection, explicit immutable-snapshot uploads through existing version/conflict/backup checks, and confirmed scoped discard or retained copies. No auto-upload or connection rebinding. Tests written; execution and native/visual/platform acceptance deferred. See `docs/REMOTE_EDITING.md`.
- [x] **F37 — Recovery (implementation):** Interrupted-transfer evidence, confirmed partial-file cleanup, and explicit verified resume. Phase 4 tests and live/platform acceptance pending; see `docs/TRANSFER_RECOVERY.md`.
  - [x] **F37-A — Durable evidence (implementation):** SQLite-backed queue acceptance and pre-mutation staging/backup/publication checkpoints; verified connection metadata; restart-visible records; confirmed metadata-only forgetting. No automatic replay. Regression tests written, execution deferred at the user's request.
  - [x] **F37-B — Partial-file cleanup (implementation):** Opened-stage creation evidence, fresh SSH host/account/key checks, canonical-path/regular-file/ownership checks and streamed source-prefix verification, single-use expiring previews, repeated checks on confirmation, and one-file cleanup preserving sources, destinations and backups. Older/unverifiable records require manual inspection. Tests written, execution deferred. See `docs/TRANSFER_RECOVERY.md` for concurrent-writer limits.
  - [x] **F37-C — Verified resume (implementation):** Matching verified connection, unchanged source/destination, exact staged-prefix checks and non-truncating access probe; remaining-byte preview, purpose-bound expiring confirmation, main-owned queue rebinding, offset copying and fresh Replace approval with retained backup. Failed/cancelled resume keeps the partial. Unsafe/uncertain records are refused. Regression code written; tests unrun at the user's request.

Completion criteria: Test permissions, interruptions, large files, symlinks, unusual filenames, overwrites, and partial transfers. Preserve originals during replacement where supported. SFTP does not automatically provide elevated permissions.

## Phase 5 — Workspaces and productivity

Dependencies: Stable sessions, storage, and credential handling.

- [x] **F38 — Split panes (implementation):** Independent sessions, draggable/keyboard resizing, spatial focus shortcuts and minimum-size scrollable layouts. Phase 5 runtime/platform acceptance remains pending.
  - [x] **F38-A — Basic splits (implementation):** Split right/down, independent local or same-host SSH sessions, click focus, stable mounted terminals, split-group tab navigation and confirmed per-pane close. Fixed equal sizes; regression code written, execution deferred.
  - [x] **F38-B — Resize and shortcuts (implementation):** Accessible pointer-captured dividers, Escape cancellation, balance/reset, keyboard limits/resizing, spatial focus shortcuts and recursive minimum sizes. Regression code written/type-checked; test execution, visual and platform acceptance deferred.
- [x] **F39 — Workspace templates (implementation):** SQLite-backed named layouts, pane/tab order and split ratios; review/open adds fresh idle panes without replacing current sessions or replaying commands. Explicit per-pane startup, missing-host/limit checks and confirmed deletion. Regression code written; execution and runtime/platform acceptance deferred.
- [x] **F40 — Snippets (implementation):** Shared encrypted local library with create/edit/delete, nested folders/tags and search; single-line Insert and target-bound, confirmed multiline Run. Vault lifecycle, quotas and regression code included; execution/runtime/platform acceptance deferred.
- [x] **F41 — Startup snippets (implementation):** Encrypted local/per-host assignment, post-connect Review/Skip notice, current-command confirmation and at-most-once submission per session. No unattended execution or completion claim; regression code written, execution/runtime acceptance deferred.
- [x] **F42 — Multiple-host execution (implementation):** Select connected verified SSH accounts, review full command/destinations, execute via independent channels and inspect per-host output/exit status. One-use previews, bounded concurrency/output/time and cancellation included; regression execution/runtime acceptance deferred.
- [ ] **F43 — Broadcast input:** Explicit mode, visible recipients, and immediate stop.
- [x] **F44 — Command history (local implementation):** Existing CH01–CH03 provide encrypted, searchable local Bash history with sensitive-entry filtering, deletion and retention. Keep this implementation; additional shell/SSH capture remains CH05.
- [ ] **F45 — Environment variables:** Host/group values and server-support requirements.
- [ ] **F46 — Shell integration:** Supported working-directory and command-state detection.
- [ ] **F47 — Autocomplete:** History suggestions already implemented in CH04, including keyboard/click insertion and popup bounds. Reuse that implementation; snippet, path and argument sources remain future work.
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


### F16 implementation and Phase 1 test gate

The main process now sends at most 64 Ki UTF-16 units per 16 ms output tick,
yielding between batches. New batch boundaries preserve surrogate pairs within
an input chunk. Output stays ordered; exit drains remaining bounded batches
before the exit event. Queue consumption avoids shifting each individual fragment.
xterm acknowledges after parsing each batch; existing 256 Ki/64 Ki pause/resume
thresholds and the 1 Mi-unit overflow limit remain in effect. Scrollback stays
at 3,000 lines. These are text-unit limits, not total process-memory guarantees.

All 86 unit tests passed on Linux, including batch bounds, ordering, exit flush,
backpressure and lifecycle coverage. Build, type, lint and format checks pass.
A 30,000-line Unix desktop workload is added. All 23 desktop tests failed during
Electron launch because chrome-sandbox ownership/mode is invalid; no desktop
behavior or throughput benchmark was verified. Sandbox settings were unchanged.
Windows/macOS and interactive program verification remain pending.

F15 and F16 checkboxes track implementation; Phase 1 acceptance remains open
until its desktop and platform checks pass. F15 cleanup remains best effort for
ordinary PTY jobs; detached or hangup-ignoring processes are outside that guarantee.


### F17 implementation update

Hosts now provides New host, Edit and Delete actions with a native modal form,
loading/error/retry states, profile counts, and case-insensitive search across
name, address and username. Deletion identifies the profile and remote address
and requires confirmation. Profiles store SSH settings only; remote connections
remain F19, and no passwords or key material are persisted.

SQLite schema v2 adds a strict hosts table through the existing transactional
migration and pre-upgrade backup flow. UUIDs survive reopen; updates refuse
missing records instead of recreating them. IPC validates the owning main frame,
argument counts, IDs and bounded fields. SQL uses bound parameters. Diagnostics
contain a fixed event only. Storage documentation and the bridge allowlist fixture
are updated.

Build, type, lint, formatting and diff checks pass. Tests cover validation,
unknown-field exclusion, persistence, targeted updates/deletion, v1 migration,
malformed IPC writes and the create/search/edit/delete desktop workflow. Tests
are written/type-checked but not executed before the Phase 2 gate. Visual and
Windows/macOS checks remain pending; the existing desktop sandbox blocker is
unchanged. Next: F18.


### F18 implementation update

Schema v3 stores group paths, optional SSH port/username defaults, host inheritance
flags and normalized tags. Existing v2 profiles retain all connection values and
start ungrouped with inheritance disabled. Migrations retain transactional writes
and pre-upgrade backups. Main-process requests validate payloads and ownership;
new narrow group methods are included in the bridge allowlist fixture.

Hosts supports New group, editing defaults, assigning groups/tags, group-subtree
and Ungrouped filters, exact tag filtering and search. Parent groups must exist;
paths are fixed, limited to eight levels and 200 characters. Tags are lowercase,
deduplicated, capped at 20 per host and 32 characters per tag. A host inherits
the closest configured group defaults only for fields it explicitly marks inherited;
otherwise its own port/username is used. Fallbacks are port 22 and blank username.
Deleting a named group requires confirmation for its entire subtree; hosts are
kept, moved to Ungrouped and retain effective connection settings and tags.

Build, type, lint, format and diff checks pass. Tests are written/type-checked for
v1/v2 migration compatibility, nested defaults, overrides, normalization, invalid
paths and payloads, reopen persistence, subtree deletion safety and desktop group
creation/filtering/confirmation. Test execution remains deferred to the Phase 2
gate. Desktop visual and platform verification remain pending under the recorded
sandbox blocker. Next: F19.


### F19 implementation update

Saved hosts now open SSH tabs through ssh2 1.17.0. The main process resolves the
saved address and inherited port, validates the session credentials and verifies
the exact SHA256 host key before authentication. The credential modal pre-fills
the effective username; passwords/fingerprints are not saved or logged and are
requested again on each explicit connection. This minimum password/pin flow
makes F19 usable; additional authentication methods remain F20 and managed
known-host trust/changed-key handling remain F21.

The existing owned-session registry now accepts a narrow transport shared by
local PTYs and SSH channels. SSH requests an xterm-256color PTY, decodes UTF-8
stdout/stderr, forwards raw input, propagates window sizes, participates in the
existing output batching/acknowledgements/backpressure, and closes on cancellation,
tab/window close, renderer loss or setup failure. A 15-second handshake and
20-second overall setup timeout bound stalled starts. Disconnection ends the
session; no command replay or automatic reconnect is performed.

Build, type, lint, format and diff checks pass. A disposable loopback ssh2 server
fixture covers Unicode IO, PTY resizing, clean exit, authentication rejection,
host-key mismatch before authentication and cancelled startup. A desktop test
covers opening/cancelling the prompt. Tests are written/type-checked but deferred
to the Phase 2 gate. No live SSH, visual or cross-platform verification is claimed;
the desktop sandbox blocker remains. Next: F20.


### F20 implementation update

Connect offers password, private-key file and keyboard-interactive methods. Key
files are explicitly selected, limited to 256 KiB and held only in modal/session
memory; optional passphrases use masked fields. Validation forwards only the
selected method's fields. Host fingerprint verification remains mandatory before
authentication. No new credential storage or logging is introduced.

Password/key authentication can continue into keyboard-interactive for servers
requiring a second factor. Dialogs name the target tab and render server text
plainly, respect prompt echo flags, and bind answers to an opaque session/request
token. Bounds: eight prompts per round, 256-character title, 2,048-character
instructions, 1,024-character prompts and 4,096-character answers. Zero-prompt
rounds are acknowledged without a dialog. Stale replies are ignored; invalid
answers, cancellation, startup failure, tab/window close and round expiry clear
pending requests. Interactive setup has a 120-second overall/handshake limit,
with 60 seconds per round. Noninteractive limits remain unchanged.

Build, type, lint, format and diff checks pass. Tests are written/type-checked for
encrypted private-key authentication, incorrect passphrases, multi-round
interactive authentication, prompt echo metadata, reply ownership/staleness,
expiry, cancellation, field exclusion and credential-method UI switching. Tests
are deferred until the Phase 2 gate. Live OpenSSH, visual and cross-platform
verification remain pending under the recorded desktop sandbox blocker. Agents,
hardware keys and stored credentials are not part of F20. Next: F21.


### F21 implementation update

Schema v4 adds endpoint-scoped SHA256 trust records, with transactional migration
and the existing pre-upgrade backup flow. Address matching lowercases names and
removes outer IPv6 brackets; ports remain distinct. Trust survives profile removal
and is shared by profiles using the same endpoint. One key is retained per
endpoint; different negotiated server key algorithms produce a change warning.

The SSH handshake now waits for asynchronous verification before authentication.
Matching saved keys proceed; unknown keys require an explicit Trust and save key
action. Changed keys show old/new fingerprints and refuse the current attempt.
To approve a rotation, the user must type the complete new fingerprint; a checked
transaction replaces only the expected previous key, then the connection ends.
A fresh attempt is required. Optional manual pins remain authoritative and cannot
override conflicting saved trust. Decline, expiry and cancelled starts do not save
unknown keys. Dialogs reuse session/token-scoped challenge replies; key trust is
constructed by the main process, separate from server authentication text.

Desktop setup now allows 120 seconds for identity/authentication decisions and
60 seconds per dialog. Build, type, lint, format and diff checks pass. Tests cover
v1/v2 migration fixture compatibility, v3-to-v4 preservation, trust persistence,
endpoint matching, refusal/rotation, stale approval rejection, pins/cancellation
and asynchronous verification before authentication. Desktop trust dialogs use
an isolated IPC fixture. Tests are written/type-checked but deferred to Phase 2
completion; live SSH, visual and cross-platform verification remain pending.
OpenSSH known_hosts import/export and multiple-key trust are not implemented.
Next: F22.


### F22 implementation update

SSH progress is emitted by the main process, scoped to its exact registry owner
and session ID. Connecting precedes socket setup, Verifying key covers host
identity checks, Authenticating begins only after key acceptance, Opening shell
follows authentication, and Connected follows successful channel and terminal
setup. Progress cannot remove a live session; callbacks from cancelled or
replaced owners are ignored. Repeated transport stages are deduplicated.

Tabs/status text expose the new stages. Connected SSH tabs count as active
sessions; every setup stage retains close confirmation. Setup failures show
Failed with sanitized messages. Normal shell/channel/network close shows
Disconnected and the exit code; transport errors show Failed. Remote terminal
exit metadata flows after final output through the existing bounded queue, so
output remains available while input/paste is disabled. Reconnecting remains an
explicit new attempt; local shell states are preserved.

Build, type, lint, format and diff checks pass. Tests are written/type-checked for
real loopback transport progress order, registry ownership/stale progress,
final output delivery, close guards and isolated desktop IPC lifecycle fixtures
covering disconnected and failed outcomes. Tests remain deferred to the Phase 2
gate. Live SSH, visual and platform verification remain pending under the
existing sandbox blocker. Next: F23.


### F23 implementation update

ssh2 keepalive requests run at 15-second intervals with three unanswered requests
allowed; closure normally occurs at the next interval (about 60 seconds, subject
to scheduling). Post-connection client-timeout errors carry a fixed keepalive
failure code through the owned terminal exit event. The renderer retains output,
disables input/paste and reports that the server stopped responding. Other
transport errors and normal disconnections retain their F22 behavior.

After an SSH attempt ends, Reconnect SSH opens fresh authentication fields. The
dialog explains that confirming starts a new shell, clears displayed output
and loses the previous session. Cancelling keeps output and performs no attempt.
Confirmed reconnects use a new UUID, resolve current host/group settings and
verify host trust again. Credentials and prior input are not retained/replayed.
View changes cannot trigger automatic reconnect. Local shell behavior is unchanged.

Build, type, lint, format and diff checks pass. An SSH loopback/proxy test blocks
traffic and advances only interval timers to exercise unanswered keepalive loss.
A desktop IPC fixture covers the lost-peer message, fresh credentials, cancelled
reconnect preserving output, view changes, new session IDs and zero input replay.
Tests are written/type-checked but deferred to the Phase 2 gate. Real timing, live
network-loss, desktop visual and Windows/macOS checks remain pending under the
recorded sandbox blocker. Next: F24.


### F24 implementation and Phase 2 test gate

Cancel connection now immediately stops a pending SSH attempt and keeps its tab
and output. Identity and keyboard-interactive dialogs use the same cancellation
path. The renderer invalidates the session ID before closing it, clears setup
state/prompts, shows SSH connection cancelled, and offers explicit reconnect.
Late progress, data or successful open responses cannot reactivate that attempt.
Closing a tab/established session retains the normal confirmation flow.

The main process returns a dedicated cancellation code instead of logging an
expected user cancellation as a connection failure. Existing abort propagation
clears challenge timers, closes the SSH client/socket, cancels shell setup and
releases registry ownership. New real loopback tests cancel during host identity
verification before authentication and during interactive prompts, then verify
server-side socket closure. A desktop IPC fixture sends late callbacks/replies
after cancellation and checks the tab stays cancelled with no stale output.

Phase 2 implementation has reached its test gate. On Linux/Node 24.12.0 all
113 unit tests across 18 files passed, including storage/migrations, host groups,
trust policy, SSH password/key/interactive authentication, resizing/output,
keepalive, cancellation and cleanup. Build, type, lint, format and diff checks
passed. Sandbox-enabled desktop tests were attempted with --max-failures=1:
the first launch failed because chrome-sandbox ownership/mode is invalid, and
34 tests did not run. No sandbox settings or OS permissions were changed.
Desktop interaction/visual checks, external OpenSSH and Windows/macOS acceptance
remain pending; Phase 2 acceptance is not declared complete. Next: F27.

### F25 implementation

F25 adds reusable SSH identity metadata and optional host/group assignments.
Identity username and authentication preference prefill the SSH prompt; each
connection still requests its password or selected key/passphrase. The SQLite
v5 migration preserves existing hosts and groups. Tests are written and deferred
until the Phase 3 gate; F26 follows.

### F26 implementation

Passwords can be saved explicitly to an assigned identity from the SSH prompt,
used on later connections without sending the saved secret through the renderer,
or forgotten with confirmation. Ciphertext is kept outside SQLite under the
application data directory and uses Electron's asynchronous safeStorage API.
Linux storage using the `basic_text` fallback is rejected; session-only SSH
connections remain available when secure storage is unavailable. Tests are
written but deferred until the Phase 3 gate; next: F27 SSH keys.

### F27 implementation

The identity manager can import a private key through a main-process file picker or generate
an Ed25519 key (no key passphrase) / RSA 2048 key (optional passphrase). Private key text and
its passphrase are encrypted together with Electron safeStorage in a permission-restricted
file outside SQLite. The renderer receives only the public key for copying; the private key
is decrypted in the main process and accepted only for the identity assigned to the host.
Tests are written and deferred until the Phase 3 gate; F28 public-key installation follows.

### F28 implementation

Hosts with an assigned managed-key identity expose **Install key**. The confirmation names
the identity, exact host/account, destination path and key. Installation is limited to hosts
whose server fingerprint is already trusted. mTerminal uses the identity's saved password or
asks for a one-time password, then uses SFTP to create/chmod `~/.ssh`, preserve existing
`authorized_keys` contents, append the key only when absent, and set the file to mode 0600.
Tests are written and deferred until the Phase 3 gate; F29 lock and unlock is implemented below.

### F29 implementation

The local vault now uses a 12–256 character passphrase to wrap a random AES-256-GCM vault
key. The passphrase-derived wrapping key uses asynchronous scrypt; individual credential
files retain Electron safeStorage as the outer OS-protected layer. Existing F26/F27 files are
migrated atomically, one file at a time, during setup/unlock; interrupted migration resumes on
the next unlock. The app starts locked after restart and locks after five minutes without
renderer activity. Locking hides the workspace and blocks future vault reads; already-open
SSH sessions remain connected. Forgotten passphrases cannot recover saved secrets; host and
identity metadata remain local and unencrypted by the vault passphrase. Tests are written and
deferred until the Phase 3 gate.

### F30 implementation

Settings can export a version 1 JSON workspace archive containing hosts, groups, SSH identity
metadata, and trusted host fingerprints. Saved passwords and private keys are excluded; credential
files remain protected in the local vault. Import validates archive size, schema, record values,
references, duplicates, and collisions before applying a single SQLite transaction. It merges new
records and never replaces existing records. User confirmation precedes import. Tests are written
and deferred until the Phase 3 gate; next: F31 recovery.

### F31 implementation

If the OS keychain is temporarily unavailable, the vault stays locked and the user is directed
to restore/unlock that same OS account keychain before retrying. The locked-vault screen offers
a confirmed reset for forgotten passphrases or corrupt vault files: mTerminal moves the encrypted
master and secret files into a restricted `vault/recovery-*` folder, preserves SQLite metadata,
and allows a new vault to be created. This cannot decrypt the preserved secrets; it prevents
accidental loss of the original ciphertext for later keychain recovery or investigation. Database
corruption uses the existing validated offline restore flow in `docs/LOCAL_STORAGE.md`. Tests are
written; Phase 3 unit gate passed (133 tests); desktop E2E launch remains blocked in this environment.

### Phase 3 test gate

On Linux/Node 24.12.0, all 133 unit tests passed. The `npm test` E2E stage attempted all
36 Playwright cases, but each Electron process failed to launch (`Process failed to launch!`),
consistent with the documented Chromium sandbox restriction. Build, typecheck, lint, formatting,
and `git diff --check` passed. Windows/macOS and interactive keychain recovery remain unverified.

### F32 implementation

Added a Files workspace inside each terminal tab, with local and remote panes, canonical folder
paths and breadcrumbs, home/up/refresh/retry navigation, hidden entries, directory-first sorting,
sizes, numeric permissions, modification dates, and explicit symlink markers. Narrow windows stack
the panes. A failed navigation retains the previous successful folder with an error message.

Remote browsing opens a bounded, short-lived SFTP channel on the existing fingerprint-verified
SSH transport, preserving the current authentication and vault workflow. Tab/session shutdown
aborts pending requests; normal browser reads close their handle/channel without ending the shell.
The window-owned preload request validates paths and session IDs, limits concurrent requests,
caps listings at 5,000 entries, and reports permissions, missing paths, disconnects and timeouts.
File contents and filesystem mutations are outside F32.

Typecheck, lint, formatting, production build and diff checks passed on Linux. Tests are written
for local browsing/metadata/filtering/sorting, sender and path validation, session ownership,
SFTP EOF, bounds, cancellation/timeout cleanup, a real loopback SSH/SFTP fixture, and the desktop
browser workflow. Test execution is deferred until the Phase 4 gate, per the development workflow.
Interactive visual checks, live-server acceptance and Windows/macOS verification remain pending.
Usage and limits: `docs/FILE_BROWSER.md`. Next: F33; commit without pushing.

### F33 implementation

Added folder creation and row action menus for same-folder rename, confirmed permanent deletion
of a file/link/empty folder, and permitted octal mode changes in both browser panes. Dialogs show
the pane/account scope and exact path. Special files, recursive deletion, symlink mode changes,
and elevation are refused. Local Windows mode changes are disabled. Local permission edits use
a no-follow descriptor and require read access; filesystem/platform rename limits are documented.

Validated `files:mutate` requests are serialized against other file operations in the window.
Local file/link rename uses exclusive hard-link creation before unlinking the source; partial
results preserve both names. Directory rename reserves an empty destination. Remote operations
reuse the verified SSH session and standard non-overwriting SFTP rename. A disconnect/timeout
during a mutation is reported as an uncertain result, never automatically retried. Refresh runs
after each attempt; remote notices remain visible after disconnection. Confirmations from an
older SSH session cannot be submitted after reconnecting.

Typecheck, lint, formatting, production build and diff checks passed on Linux. Regression tests
are written for payload validation, session ownership, mutation serialization, collision and
nonempty-folder preservation, modes/symlinks, partial local rename, remote disconnect outcomes,
and desktop confirmation/cancel/refresh flows. Tests are deferred until the Phase 4 gate.
Live-server, interactive visual and Windows/macOS verification remain pending. Next: F34.

### F34 implementation

Added Upload/Download actions for regular files after both browser folders load, with a dialog
showing the SSH tab, file, direction and captured folders. A window-owned queue holds up to 32
jobs and runs one at a time. It displays throttled byte progress, status, queued/active cancel,
sanitized failures, uncertain publication outcomes and possible leftover staging paths. Clearing
finished jobs removes only queue records. Settled jobs refresh visible folders; browser reads
are serialized within each pane to avoid overlapping a completion refresh with navigation.

Copies reuse a separate SFTP channel on the verified SSH connection, with a 64 KiB buffer,
per-request deadlines, source size/mtime checks, and destination staging files created exclusively
with restrictive permissions. Upload publishes with standard non-overwriting SFTP rename;
download syncs/closes the staging file and uses exclusive hard-link publication. Existing and
concurrently created destinations are refused. Cancellation attempts bounded cleanup without
removing final destination files; source files are not removed. Downloads require a filesystem
that supports hard links. This is not checksum verification, immutable source capture or resume.

The queue survives closing Files or switching views. Session close/reset/disconnect cancels its
queued and active work, renderer reload/crash cancels outstanding work, and browser mutations
are refused during an active transfer. Requests validate window ownership, paths, names and active
SSH session ownership. Queue state is memory-only; jobs never reconnect or replay automatically.

Typecheck, lint, formatting, production build and diff checks passed on Linux. Regression tests
are written for copying, empty files, destination collisions including publication races, source
changes, cancellation/cleanup, uncertain rename acknowledgments, deadlines, queue ordering/limits,
session lifecycle notifications, IPC boundaries and desktop progress/cancel/clear interactions.
Tests remain unrun until the Phase 4 gate. Live-server, interactive visual and Windows/macOS
acceptance remain pending. Usage and limits: `docs/FILE_BROWSER.md`. Next: F35; do not push.

### F35 implementation

Existing destinations now pause jobs in a conflict state while other queued jobs continue.
Resolve opens a metadata preview with canonical source/destination paths, kinds, sizes, modified
times and modes. Skip is focused by default; Replace and Cancel are explicit. Only regular files
with usable metadata can be replaced. A token-bound decision resolves only the current preview;
the renderer never supplies overwrite paths, versions or filesystem flags.

The main process retains approvals and rechecks source/destination metadata before copying and
the destination before publication. Changed items require a fresh decision. Replacement copies
to staging, captures the actual old destination at an exclusive `.bak` path, validates it, and
publishes without overwriting newly created items. Completed replacements retain the previous
file and show its backup path. A failed attempt after acknowledged capture tries to restore only
into an absent destination; unresolved recovery paths and lost-reply outcomes remain visible.
Local hard-link support is checked before moving the original. File modes remain transfer-default
0600 where supported; directory/symlink replacements, automatic backup deletion and replace-all
policies are absent. This sequence is not an atomic exchange; recovery indexing is not persisted.

Typecheck, lint, formatting, production build and diff checks passed on Linux. Tests are written
for local/remote retained backups, stale source and destination previews, directory refusal,
cancel/restore, concurrent destination preservation, uncertain backup capture, main-owned approval
snapshots, token/IPC validation, Skip without recopying, and keyboard/default/conflict UI flows.
Tests remain unrun until the Phase 4 gate. Live-server, visual and Windows/macOS verification
remain pending. Usage and limits: `docs/FILE_BROWSER.md`. Next: F36; do not push.

### F36 implementation

Added one-file remote UTF-8 editing through the remote Actions menu. After an explicit plaintext
copy notice, the main process prepares a private app-data working folder and opens only a
generated `editing.txt` file using the system default text application. Downloads enforce the
1 MiB bound before copying; readers reject invalid UTF-8/binary controls, symlinks, oversized or
changing local copies. Origin metadata is saved separately without credentials or document text.

The Remote editor panel shows saved-change detection, connection state, copy/recovery paths,
reopen, Upload changes, Keep copy and finish, and confirmed local-only discard. Saved bytes are
hashed once per second; saving alone never uploads. Explicit upload captures an immutable local
snapshot and uses the existing queue with main-owned original remote metadata approval. Changed
remote files require the F35 conflict decision. Acknowledged published metadata becomes the next
baseline, while saves made during the upload remain pending. Uncertain/recovery uploads retain
their snapshot and block blind retry. Disconnection never rebinds the editor to a different SSH
session, and copies remain available locally after disconnect or window shutdown.

Validated, window-owned editor actions accept no local path, executable command or deletion
target from the renderer. Private folder paths are canonicalized; POSIX modes are restrictive.
Kept copies are plaintext and are not automatically indexed after restart. External editor
buffers/termination cannot be detected; discard explicitly warns to close the editor first.

Typecheck, lint, formatting, production build and diff checks passed on Linux. Tests are written
for bounded text/request validation, forced text launch, saved-change detection without auto-upload,
snapshot isolation/later saves, updated publication metadata, conflicts and uncertainty, disconnect
retention, launch failure, keep/scoped discard, symlink refusal, IPC boundaries and the editor panel.
Execution remains deferred to the Phase 4 gate. Actual default-editor launch, live SSH/SFTP,
interactive visual and Windows/macOS verification remain pending. See `docs/REMOTE_EDITING.md`.
Next: F37; commit without pushing.


### F37-A implementation — 2026-11-09

Persisted bounded transfer evidence in SQLite schema 6 using the existing migration/backup
process. Queue acceptance and planned staging, backup and publication paths commit before
file mutations. Records include the earlier verified address, port, username and host-key
fingerprint plus available original file metadata; credentials, contents and conflict approval
tokens are excluded. An unreadable/full journal refuses new work without evicting evidence.
Failed final journal writes preserve the earlier checkpoint and report an uncertain outcome.

Files now shows a compact Saved transfer recovery panel independent of the current queue.
Records survive restart, disconnect, renderer reset and Clear finished. Interrupted records
are evidence for inspection, never executable jobs; old session IDs do not rebind to new SSH
connections. Forget record asks for confirmation and removes metadata only; active jobs cannot
be forgotten. Successful transfers with no remaining staging/backup paths remove their journal
entry automatically. Workspace JSON exports exclude the journal; SQLite snapshots include it.

Regression code covers restart/no replay, migration from schema 5, capacity without eviction,
malformed-record preservation, final-save failures, pre-mutation checkpoint failures, IPC guards,
and the renderer confirmation flow. Test cases remain unrun at the user's explicit request.
`npm run check` (including test-source type checking), `npm run build`, and
`git diff --check` passed on Linux x64; no test cases were executed. Live SFTP, actual crash/restart,
visual, native editor and Windows/macOS acceptance remain pending.

F37 remains unchecked: next is F37-B cleanup, then F37-C verified resume. Editor preparation
copies and retained working-copy discovery are outside this transfer-journal substep. See
`docs/TRANSFER_RECOVERY.md`. Commit locally with the phase and step; do not push.


### F37-B implementation — 2026-11-09

Added explicit Inspect temporary file and confirmed Delete temporary file actions to the saved
recovery panel. The current SSH tab must match the earlier address, port, username and verified
host-key fingerprint, including for local download partials. Renderer requests contain record IDs,
session IDs and opaque tokens; privileged code derives and verifies every actionable path.

New transfers persist the empty, opened staging identity before copying. The existing schema-6
JSON journal accepts this optional field while retaining older records; records without creation
evidence remain manual-only. Verification checks canonical source/destination folders, generated
`.part` names, regular files, private mode, creation identity/ownership, unchanged source metadata,
and exact source-prefix bytes. A confirmation stores the inspected version/digest and expires
after 60 seconds. Confirmation reruns verification and refuses changed records, files or peers.

Only the verified staging name is unlinked. Source/final destination/backup names are never cleanup
targets, and other hard-link names are preserved. After success, the partial path is cleared in the
journal and visible queue; backup/outcome evidence remains. File panes refresh after attempts.
Storage is checked before deletion; post-delete persistence or acknowledgement failures remain
uncertain with earlier evidence retained. Reload, renderer loss, disconnect and window close
invalidate approvals and cancel pending work. Cleanup is serialized against competing file work.

Regression code covers local/remote partials, source/destination/backup retention, changed bytes
and source versions, creation checkpoint ordering, symlinks, inode replacement, hard-link names,
peer mismatches, record changes, token expiry/reuse, renderer reset, IPC validation and the
Cancel-first desktop confirmation. Tests remain unrun at the user's request. `npm run check`, `npm run build`, and `git diff --check` passed on Linux x64;
no test cases were executed. Live SFTP, visual, actual crash/restart and
Windows/macOS acceptance remain pending.

Standard SFTP cannot provide a portable inode identity or conditional unlink; local unlink also
has a final pathname race. Repeated metadata/content checks reduce stale decisions but do not
guarantee atomic deletion against concurrent writers. See `docs/TRANSFER_RECOVERY.md`.
F37 remains unchecked until F37-C verified resume is implemented. Commit locally; do not push.


### F37-C implementation — 2026-11-09

Added Resume previews and explicit confirmation to saved recovery records. The current SSH
address/port/account/host key must match. Inspection verifies the created staging identity,
canonical paths, private mode, source version and exact prefix bytes; the destination must still
match its recorded version or remain absent. Non-truncating local/SFTP access is probed before
showing verified/total/remaining byte counts. Local download stages with extra hard links are
refused. Missing creation evidence, retained backups and uncertain backup/publication states
remain manual-only. Fully copied stages can be published after verification without new writes.

Confirmation is single-use, expires after 60 seconds and is purpose-bound; cleanup tokens cannot
resume a transfer. Record changes, disconnects and renderer reset invalidate approval. Resume
reuses the original recovery ID with a fresh explicitly selected connection, journaling before
execution and preventing duplicate ownership. The queue revalidates on its own SFTP channel,
opens the existing stage without truncation and writes from the verified offset. Existing source,
destination, close/sync, backup and staged-publication safeguards remain. Replacing a recorded
unchanged destination requires a fresh Resume and replace confirmation and creates a new backup.

Resumed failures/cancellation retain the adopted partial for inspection or a fresh preview.
Journaled first attempts also retain staging after pre-publication disconnect/timeout, so ordinary
network interruptions can actually be resumed. Explicit cancellation of a new transfer and
untracked editor preparation keep their previous cleanup policy. Publication clears/removes the staging
name where possible and reports leftovers or uncertain acknowledgement/persistence normally.
The original source snapshot is still required, including for editor-upload recovery. Storage
continues using the existing schema-6 journal without persisting approval tokens or byte contents.

Regression code covers upload/download offsets and exact final bytes, replacement backup
retention, cancellation and renewed inspection, stale records/files/destinations, unsupported
access, unsafe publication refusal, fully copied stages, durable rebinding and duplicate-ownership
refusal, first-attempt interruption-to-resume, purpose-separated IPC tokens and Cancel-first UI. Tests remain unrun at the user's
explicit request. `npm run check`, `npm run build`, and `git diff --check` passed on Linux x64;
no test cases were executed. Live SFTP,
crash/restart, visual, concurrent-writer and Windows/macOS acceptance remain pending.

F37 and Phase 4 implementation are marked complete; acceptance is not claimed. Prefix verification
rereads data, server probes do not establish vendor compatibility, and SFTP metadata/path races
retain the limits documented in `docs/TRANSFER_RECOVERY.md`. Next: Phase 4 verification gate when
test execution is requested, then F38 split panes. Commit locally with phase/step; do not push.


### F34-A file-pane drag-and-drop — 2026-11-09

Added user-requested bidirectional single-file drag-and-drop between the Local and Remote panes.
Rows become draggable only with a loaded, successful listing and an app-managed SSH transfer
context. The target pane highlights its current folder; a drop opens the existing Upload/Download
confirmation with both paths. Cancel leaves files unchanged; Add to queue uses the existing
validated main-process transfer, conflict/backup, cancellation and recovery workflow.

Drag data contains only an opaque token bound to an in-memory selected row. No dropped paths,
file contents or URLs are parsed. Changed session/source-folder selections, unavailable/stale
targets, same-pane moves, directories, symlinks and foreign drops are refused. Native OS file
manager drops, folder copying and multi-file selection remain outside this substep. Dropping on
a folder row still uses the destination pane's open folder, shown in the confirmation.

Regular-file rows now have visible Upload/Download buttons and a file-specific right-click menu;
actions stay visible while scrolling metadata horizontally. A compact help line distinguishes
this workflow from terminal Copy/Paste/Close session actions. Native keyboard buttons remain an
alternative to dragging, with Cancel focused by default in the existing modal.

Regression code covers both transfer directions, unchanged preview/cancel behavior, exact queued
paths, forged tokens, non-file/same-pane/stale selections, visible actions and row menus. Tests
remain unrun at the user's request. `npm run check`, `npm run build`, and `git diff --check`
passed on Linux x64; no test cases were executed. Live SFTP, actual pointer interaction, visual
and Windows/macOS acceptance remain pending.
No new dependencies, preload APIs, backend filesystem capabilities or database migrations.
Continue with the Phase 4 verification gate when test execution is requested, then F38 split panes.
Commit locally with phase/step; do not push.


### F32-A file-browser design improvements — 2026-11-09

Reworked the file view around the user's SFTP reference while retaining mTerminal branding and
application theme. Each pane uses two compact rows: heading with Filter/Actions and selected-file
Upload/Download, then Back/Forward/Up, breadcrumbs and an on-demand path editor. Filename filtering
is case-insensitive and local to loaded entries. Sortable headers replace the sort-control row;
columns are Name, Date Modified, Size and Kind. Filled folder icons and symbolic permissions below
names improve scanning while retaining octal tooltips and special permission bits.

Single-click selects; double-click/Enter opens folders. Keyboard arrows/Home/End move selection,
and Shift+F10 opens row actions. Pane and row menus reuse existing scoped mutation/editor/transfer
confirmations. Selection is derived from fresh visible entries and scoped to directory/connection;
filtered or stale entries do not enable selected-file actions. Navigation history commits only
successful canonical paths, supports Back/Forward, truncates new branches and is bounded to 64
entries. Refreshes do not duplicate history and background refresh does not replace a path draft.

Idle transfer history and saved recovery lists collapse behind accessible summary controls. Active,
conflict and failed transfer details stay visible; errors remain visible. The empty editor is
hidden, an unchanged ready edit is compact, and pending saved edits/active work/errors open its
details. File dialogs, queue/recovery watchers, default Cancel focus, drag tokens, copy confirmation,
backups and explicit resume/cleanup behavior remain in the existing flow. No backend, preload,
storage schema, dependency or server-package changes were needed. Separate SFTP workspace tabs,
multiple selection and folder transfers are outside this interface step.

Regression code was updated/written for path/history navigation, filtering, column sorting,
symbolic permission bits, single-file selection, keyboard folder access, collapsed panels and
existing actions/drag-transfer confirmations. Tests remain unrun at the user's request.
`npm run check` (including test-source type checking), `npm run build`, and `git diff --check`
passed on Linux x64; no test cases were executed. A temporary fixture-only preview was prepared,
but computer-use reported no available browser, so no visual or interactive pass is claimed.
Live SFTP, actual pointer/keyboard behavior and Windows/macOS acceptance remain pending.

Preserve unrelated local-storage documentation edits and the supplied reference image outside
this commit. Next remains the Phase 4 verification gate when test execution is requested, then
F38 split panes. Commit locally with phase/step; do not push.


### F26-A remembered SSH login fixes — 2026-11-09

Investigated repeated username/password prompts after closing an SSH tab. A username typed only
in SshPrompt was not persisted to an empty profile, so one-click lookup could not construct a
saved login even when a password existed. Also, the prompt's Use saved password option supplied
the optional assigned identity ID instead of the actual resolved host/password owner, breaking
host-owned saved-password selection when no identity was assigned.

Added an opt-out username checkbox only when the effective default is empty. Before connecting,
a fresh host/group/identity lookup fills that missing username in the same host and disables its
empty username inheritance. Existing effective host/group/shared-identity usernames are not
rewritten, shared identities are not mutated, and unrelated host metadata is retained. Saved
password selection now uses passwordOwner; private-key ownership remains unchanged.

Connect waits for credential-status lookup and blocks duplicate submits during saving. Cancelling
or unmounting the prompt prevents a pending save from starting SSH afterward. The prompt is keyed
by host/notice so a new context starts with fresh credential state. Password saving remains in the
existing passphrase/OS-protected vault; no plaintext fallback, auto-unlock, new storage schema or
privileged bridge method was introduced. The UI explains session-only passwords and unlocking
once after app restart. Local saves already submitted may complete even if the dialog is cancelled.

Unit regression code covers missing-username persistence, configured/inherited/shared defaults,
removed hosts, locked/unavailable vault lookup and reference-only automatic credentials. Isolated
IPC desktop regressions cover first-save/close/reopen, host-owned password selection and cancel
during a pending password save. Tests remain unrun at the user's request. `npm run check`,
`npm run build`, and `git diff --check` passed on Linux x64; no test cases were executed. No real SSH connection or OS-keychain/visual/platform pass is
claimed. See `docs/SSH_SESSIONS.md` for usage and boundaries.

Keep unrelated local-storage edits/reference image outside this commit. Continue with the Phase 4
verification gate when test execution is requested, then F38. Commit locally with phase/step;
do not push.


### F26-B complete host login — 2026-11-09

Supersedes F26-A's separate missing-username checkbox. The connection dialog now offers one
unchecked **Save username and password for this host** option. Checking it opens existing
vault setup/unlock when needed and saves both fields as one encrypted per-host record before
connecting. Closing/reopening a host uses the saved pair directly. Unchecked entries are
session-only and do not overwrite older saved credentials; Forget removes stored credentials.

Paired records take priority over profile, group and identity defaults without rewriting those
records. Main resolves both saved fields, enforces host/identity ownership, and returns only
status/username through preload. Atomic encrypted writes, corruption checks, legacy-password
compatibility, keychain rotation, vault migration/reset and deletion include the new login format.
No dependencies added. Host editor password saves use the complete login too.

Regression code covers both save modes, setup from the prompt, close/reopen, main-only secret
resolution, account precedence, legacy passwords, restart, encrypted files, failed replacement,
corrupt records, forgetting and pending-save cancellation. Tests were not executed per user
instruction. `npm run check`, `npm run build` and `git diff --check` passed on Linux x64. Live SSH, real OS-keychain restart, visual and
Windows/macOS behavior remain unverified. Preserve unrelated local-storage edits/reference image.


### F38-A basic split panes — 2026-11-09

Added Split right/down to terminal and tab context menus. A split creates a new session ID
and independent shell, or a separate connection to the same SSH host. Existing saved-login
lookup is reused; one-time credentials are not copied between panes. All sessions share the
existing maximum session count. No IPC, dependency, credential-storage or process-model changes.

The renderer maintains split layout trees but renders terminals as stable keyed siblings, so
splitting, navigating and collapsing a layout do not remount surviving terminals. Equal-size
positions support nested splits; existing ResizeObserver sizing updates each terminal/PTY.
Each pane retains a session tab. Selecting a tab shows its group and focuses that pane;
click/focus updates the selected tab and active border. New terminal/host requests remain
independent groups. Closing live work retains the existing confirmation and closes only its
session; remaining branches expand and focus stays in the group. Layouts are in memory only.

Existing autocomplete/history are retained. F44 now links the completed local history work;
F47 records the existing history suggestion source without marking future sources complete.
F38 remains incomplete until F38-B adds divider resizing and pane shortcuts.

Regression code covers nested directions, bounds, stable session records, group collapse/focus,
SSH host-only copying, invalid split requests and shared limits. Desktop regressions cover
independent local shell state, retained xterm nodes, group/view navigation, click focus,
close confirmation/cancellation and independent SSH prompts. Tests remain unrun per user
instruction. `npm run check`, `npm run build` and `git diff --check` passed on Linux x64.
Visual, live SSH, native focus/PTY interaction and Windows/macOS acceptance remain unverified. Preserve unrelated local-storage edits/image.


### F38-B pane resize and focus shortcuts — 2026-11-09

Added persistent-in-memory split ratios and accessible separators with pointer capture,
orientation/range/control semantics, keyboard arrows, Home/End limits, Enter/double-click
balance and Escape/pointer-cancel rollback. Divider unmount/lost capture releases drag state;
no global pointer listeners or new dependencies. Geometry is a focused pure module reused
by layout, divider bounds, spatial focus and unit regression code.

Each pane has a recursive 260 × 160 CSS-pixel minimum. Undersized windows scroll a virtual
layout instead of shrinking sessions out of usability. Effective ratios clamp to available
space without rewriting preferences on window resize, so expanding the window restores them.
Stable keyed terminal siblings and existing ResizeObserver/TerminalSizing continue fitting
xterm and publishing PTY/SSH grid changes without recreating sessions.

Alt+Shift+Arrow focuses a spatial neighbor; Ctrl+Alt+Shift+Arrow moves the nearest matching
ancestor divider by two percentage points. Terminal-only capture prevents reserved keys
from reaching the shell and skips dialogs, menus, text fields and IME/AltGraph events.
The existing navigation-shortcut preference controls these bindings; Settings documents them.
Divider keyboard operation remains available with global navigation disabled.

Regression code covers nested geometry/minimums, preferred-ratio restoration, group ownership,
retained session records, spatial neighbors, shortcut modifiers, drag/key resize, cancellation,
PTY output, small windows, shell-input isolation, search focus and disabled navigation.
Tests were not run per user instruction. `npm run check`, `npm run build` and
`git diff --check` passed on Linux x64. Live SSH resize,
native pointer/touch and screen-reader use, visual quality, OS shortcut conflicts and
Windows/macOS acceptance remain unverified. F38 implementation is complete; F39 is next.


### F39 workspace templates — 2026-11-09

Added a Workspace templates dialog in the session strip. Save the complete current layout
under a unique name; review its local/SSH destinations, open a fresh idle copy, or confirm
metadata-only deletion. Opening brings Workspace into view and retains existing sessions.
Every restored pane/divider receives a new ID. Start local shell / Connect SSH remains an
explicit action per pane, retaining the existing SSH login, vault and host-key checks.
No commands, process state, terminal output or credentials are stored/replayed.

Added SQLite schema 7 through the backed-up migration chain and narrow sender-validated
list/save/delete IPC. Version-1 payload validation bounds records/depth/counts, rejects extra
fields, validates layout/pane bijections, ratios, UUIDs and active selection. Saving verifies
host references; deleted hosts remain visible in templates and opening is blocked rather than
silently dropping panes. Names are unique; 50 templates and 16 total session tabs are enforced.
Opening appends atomically or refuses the whole layout. Existing JSON backup format is unchanged;
full SQLite snapshots include templates. See `docs/WORKSPACE_TEMPLATES.md`.

Regression code covers metadata-only snapshots, fresh idle IDs, SSH references, existing-session
preservation, atomic restore limits, invalid/cyclic layouts, schema 6 migration, persistence,
duplicates, deletion, stale hosts and IPC validation. Updated the schema-5 transfer-recovery
fixture to remove both later tables before exercising the migration chain. Existing tests
remain deferred at the user's request. `npm run check`, `npm run build` and `git diff --check`
passed on Linux x64. SQLite migration execution, native/visual behavior, live SSH and
Windows/macOS acceptance remain unverified.
Unrelated local-storage documentation edits and reference image remain outside this change.


### F40 encrypted command snippets — 2026-11-09

Added Snippets to the terminal tools tabs and More actions. Create/edit reusable commands,
organize with nested folders and tags, filter/search, confirm deletion, insert one line without
Enter, or preview the complete command and pane title before explicitly running. Multiline
commands require Run. Existing history suggestions remain unchanged; snippet suggestion sources
are future F47 work. Snippets never run automatically or as part of template restoration.

The shared library lives in passphrase/OS-protected `snippets.enc`, using existing vault
serialization and atomic ciphertext writes. Read/write limits, version/record validation,
UUID ownership, duplicate-name checks, no insecure keychain fallback, keychain rotation and
vault reset preservation are included. No SQLite schema/dependency changes. Sender-validated
CRUD IPC returns safe failures and content-free change notifications; commands never enter
diagnostics or default exports. Lock clears loaded snippet/editor/preview state.

Run binds reviewed content to the current session and terminal objects, checks the vault,
visibility, selected pane, input readiness and supported Bash prompt again before submitting.
Generation guards invalidate cancelled, locked or disposed previews after asynchronous checks.
Unsupported/SSH prompt detection is explicitly described; no claim of program-state detection.
Existing paste/input handling is reused, and no command is replayed on failure or reconnect.

Regression code covers command/control validation, folder/tag search, encrypted persistence,
editing/deletion, lock/restart/reset, failed writes, corruption, quotas/insecure backend,
IPC ownership/arity/safe errors, UI CRUD, Insert without Enter, multiline Run cancellation,
split-pane targeting and changed-session refusal. Test execution remains deferred at the user's
request. `npm run check`, `npm run build` and `git diff --check` passed on Linux x64.
Live SSH, real keychain restart, native/visual and Windows/macOS acceptance remain unverified. See `docs/SNIPPETS.md`. Preserve unrelated local
storage documentation edits and the reference image.


### F41 connection-time startup snippets — 2026-11-09

Added one encrypted assignment per saved SSH host and a shared local-terminal assignment in
Terminal tools → Snippets. Assigning/clearing affects new successful connections, including
explicitly started template panes and splits. The optional startup catalog field preserves
compatibility with existing version-1 snippet files; CRUD retains assignments, snippet deletion
removes references atomically, and host validation prevents assigning to missing hosts. No
SQLite migration, dependency, plaintext binding or default-export change.

Each successful connection checks its assignment once and displays Review startup / Skip.
Review uses the existing full-command confirmation, refetches current content and binds it to
the session/terminal/generation. Confirmation revalidates the assignment, vault, selected visible
pane, readiness and supported prompt state. Skip/Cancel consumes the startup action; recording
an attempt before sending prevents replay after an uncertain partial send. The notice explicitly
does not report command completion. Reconnect creates a fresh review offer, not automatic input.

Disconnect/unmount invalidates late lookup results; lock clears decrypted notices/previews.
A manual Check startup snippets action handles lookup failures after unlock without repeating
consumed actions. Existing manual snippets remain separate. Unsupported shell/SSH prompt state
requires the user to confirm readiness. See `docs/SNIPPETS.md#startup-assignments`.

Regression code covers old catalog compatibility, target/reference/count validation, encrypted
host/local persistence, edits/deletion, failed assignment writes, IPC target ownership, UI
assignment, zero input before approval, cancel/skip, one submission across focus changes,
explicit reconnect, changed assignment refusal and late lookup disposal after exit. Tests
remain unrun at the user's request. `npm run check`, `npm run build` and `git diff --check`
passed on Linux x64. Visual/accessibility, real keychain, live SSH and Windows/macOS acceptance
remain unverified. Preserve unrelated
local-storage documentation edits and the reference image. F42 is next.


### F42 reviewed multiple-host command batches — 2026-11-09

Added Run on hosts in the session strip. Select connected verified SSH accounts, enter a
command, review exact normalized text and destination usernames/addresses/ports/fingerprints,
then explicitly start. Identical connected accounts are deduplicated. Existing authenticated
clients are reused; no new login, host-key bypass, startup-snippet invocation, interactive
input broadcasting or local shell execution is introduced.

Main-owned one-use reviews expire after 60 seconds and validate every session/peer before
sending anything. Queued destinations are rechecked, never replaced/reconnected. Separate
non-interactive exec channels provide stdout/stderr, exit code/signal and independent success,
failure, cancellation, timeout, output-limit and disconnect states. Zero exit plus closed
channel is required for success. Concurrency is three, destinations are capped at sixteen,
and each command has a 60-second/64-KiB combined-output bound. Unicode decoding is incremental.
Exec cancellation/cleanup never destroys the shared SSH client; parent disconnect still ends
its channels. Channel closure cannot guarantee remote process termination or rollback.

The panel can close/reopen around an approved running batch; only latest results are retained
in memory. Window close includes active batches; reload/crash/disposal cancels queued/local
channels and clears previews/results. Vault lock closes the panel without cancelling approved
remote work. Narrow sender-validated IPC exposes no credentials or arbitrary process API.
No dependencies, SQLite migrations, persistent commands/output or logging changes.

Regression code covers side-effect-free review, one-use/expired tokens, identity changes,
deduplication, concurrency, per-host failures, cancellation, reset, IPC ownership/arity,
UTF-8 and output limits, timeout, absent exit status, shared-client preservation, late-channel
cleanup, UI review/cancel, independent host results and retained partial output. Tests remain
unrun at the user's request. `npm run check`, `npm run build` and `git diff --check` passed
on Linux x64. Real SSH, remote-process lifetime, visual/accessibility and Windows/macOS
acceptance remain unverified. See
`docs/MULTI_HOST_EXECUTION.md`. Preserve unrelated local-storage documentation edits/image.
