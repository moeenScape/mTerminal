# Terminal Development Roadmap

Created: 2026-10-28  
Target platforms: Ubuntu/Linux, Windows, and macOS  
Scope: A Termius-style desktop terminal and infrastructure client  
Excluded: Mobile applications

This roadmap tracks mTerminal features and release verification.

## Development tracking

- Unchecked means implementation is planned or incomplete; checked means the implementation step is delivered. Phase verification is tracked separately: a checked feature does not mean its deferred tests or all platform checks have passed.
- Keep feature IDs stable and reference them in commits, issues, and pull requests.
- At the end of each implemented step, stage its related changes and commit using `Phase <number> / F<id>: <imperative summary>`. Do not push.
- Keep the current verification status and release blockers up to date. Git records individual implementation changes.
- Record which operating systems were actually tested.
- A successful build alone does not establish runtime compatibility.
- Update this roadmap when scope, technology choices, or platform support changes.
- Do not mark a phase complete until its completion criteria are met.
- Write tests alongside features; execute them after the phase implementation is complete. During feature development, build, lint, formatting, and type checks may run without executing tests. Record deferred test execution explicitly.

## Current progress

| Field | Value |
| --- | --- |
| Release scope | The first release follows F71. Phase 9 is future work. |
| Latest implementation | F71 administrative events |
| Current priority | First-release verification, packaging, and documentation |
| Release readiness | Open. See [verification status](#verification-status) and the [release checklist](#release-engineering). |

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

The Electron desktop app lives in `apps/desktop/`. The optional account service lives in
`apps/server/`, and shared contracts live in `packages/shared/`. Local terminal and SSH
workflows can run without the account service.

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

- [x] **F38 — Split panes (implementation):** Independent sessions, draggable/keyboard resizing, spatial focus shortcuts and minimum-size scrollable layouts. User-tested on Linux.
  - [x] **F38-A — Basic splits (implementation):** Split right/down, independent local or same-host SSH sessions, click focus, stable mounted terminals, split-group tab navigation and confirmed per-pane close. Fixed equal sizes; regression code written, execution deferred.
  - [x] **F38-B — Resize and shortcuts (implementation):** Accessible pointer-captured dividers, Escape cancellation, balance/reset, keyboard limits/resizing, spatial focus shortcuts and recursive minimum sizes. Regression code written/type-checked; test execution, visual and platform acceptance deferred.
- [x] **F39 — Workspace templates (implementation):** SQLite-backed named layouts, pane/tab order and split ratios; review/open adds fresh idle panes without replacing current sessions or replaying commands. Explicit per-pane startup, missing-host/limit checks and confirmed deletion. Regression code written; execution and runtime/platform acceptance deferred.
- [x] **F40 — Snippets (implementation):** Shared encrypted local library with create/edit/delete, nested folders/tags and search; single-line Insert and target-bound, confirmed multiline Run. Vault lifecycle, quotas and regression code included; execution/runtime/platform acceptance deferred.
- [x] **F41 — Startup snippets (implementation):** Encrypted local/per-host assignment, post-connect Review/Skip notice, current-command confirmation and at-most-once submission per session. No unattended execution or completion claim; regression code written, execution/runtime acceptance deferred.
- [x] **F42 — Multiple-host execution (implementation):** Select connected verified SSH accounts, review full command/destinations, execute via independent channels and inspect per-host output/exit status. One-use previews, bounded concurrency/output/time and cancellation included; regression execution/runtime acceptance deferred.
- [x] **F43 — Broadcast input (implementation):** Reviewed SSH session recipients, dedicated text composer, multiline confirmation, Enter/Interrupt controls and immediate stop. Disconnect/focus/navigation/vault lifecycle disarms the mode; regression execution/runtime acceptance deferred.
- [x] **F44 — Command history (local implementation):** Existing CH01–CH03 provide encrypted, searchable local Bash history with sensitive-entry filtering, deletion and retention. Keep this implementation; additional shell/SSH capture remains CH05.
- [x] **F45 — Environment variables (implementation):** Host/group editors, parent → child → host overrides, literal SSH shell/exec env requests, schema-v8 persistence and backup round-trips. Server AcceptEnv requirements and unconfirmed acceptance are documented; regression execution/runtime acceptance deferred.
- [x] **F46 — Shell integration (implementation):** Local Bash 5.1+ directory, prompt/waiting/running states and paired completion exit codes; session-bound metadata, per-pane display and unsupported-shell fallback. Existing history/snippet behavior retained; regression execution/runtime acceptance deferred.
- [x] **F47 — Autocomplete (implementation):** Completed history, snippet, local path and scoped command-argument sources below; user-tested on Linux.
  - [x] **F47.1 — Snippet source (implementation):** Match safe single-line saved commands by prefix, show source/name/folder, deduplicate with history and revalidate before insert-only acceptance. Existing history execution remains available; regression execution/runtime acceptance deferred.
  - [x] **F47.2 — Local path source (implementation):** Owned local Bash prompt/cwd/HOME context, bounded names-only filesystem reads, safe literal suffixes and insert-only File/Folder suggestions. Revalidation and stale-result refusal included; regression execution/runtime acceptance deferred.
  - [x] **F47.3 — Argument source (implementation):** Static Git/npm/ls subcommand and standalone-flag catalogs, explicit grammar limits, source labels/descriptions and insert-only acceptance. No command discovery/execution; regression execution/runtime acceptance deferred.
- [x] **F48 — Session logs (implementation):** Explicit local/SSH output recording, encrypted checkpoints, saved transcript viewer, notes/bookmarks/comments, access-based 30-day retention and confirmed deletion. Quotas, vault/window lifecycle and regression code included; test execution/runtime/platform acceptance deferred.

Completion criteria: Workspace restoration does not silently repeat destructive commands. Broadcast destinations remain visible. Verify log limits and deletion, including sensitive-output handling. Unsupported shell integration must degrade gracefully.

Phase 5 verification: user-tested on Linux (2026-11-19). macOS/Windows acceptance remains unverified.

## Phase 6 — Advanced connections and authentication

Dependencies: Stable SSH and session lifecycle. Prototype each adapter before selecting its implementation.

- [x] **F49 — Port forwarding (implementation):** Local, remote, and dynamic (SOCKS5) forwarding with saved per-host rules and start/stop/status on the connected SSH session. Tests written, execution deferred to the phase run; live server acceptance pending.
- [x] **F50 — Jump hosts (implementation):** Per-host jump host chains up to three hops, saved-login authentication and host-key verification per hop, and cleanup of every hop with the session. Tests written, execution deferred to the phase run; live server acceptance pending.
- [x] **F51 — Proxies (implementation):** Saved SOCKS5 (optional login), SOCKS4/4a and HTTP CONNECT proxies with vault-stored passwords, chosen per host for the first SSH connection, including in front of jump hosts. Tests written, execution deferred to the phase run; live proxy acceptance pending.
- [x] **F52 — SSH agents (implementation):** System agent discovery (SSH_AUTH_SOCK, Pageant, Windows OpenSSH pipe) with key listing, per-host or per-connection agent sign-in including jump hops, and explicit per-host agent forwarding with a trust warning. Tests written, execution deferred to the phase run; live server acceptance pending.
- [ ] **F53 — SSH certificates (deferred, revisit on demand):** Formats, algorithms, expiry, and interoperability. ssh2 1.17 has no OpenSSH certificate support: user certificates would need a signing wrapper prototyped against a real CA-trusting server, and host certificates cannot be requested. Certificates held in an SSH agent may already work through F52 (unverified).
- [ ] **F54 — Hardware and biometric keys (deferred, revisit on demand):** Platform integration and physical-device verification. ssh2 1.17 does not support FIDO (`sk-*`) keys; revisit with a library upgrade or agent-based signing when a user needs it.
- [x] **F55 — Serial (implementation):** Port discovery, saved profiles with full line configuration, Enter translation and local echo, actionable permission/busy/missing errors, disconnect handling and Send break. Tests written, execution deferred to the phase run; hardware acceptance pending.
- [ ] **F56 — Telnet (deferred, revisit on demand):** Revisit when a user needs network access to legacy equipment that only supports Telnet. Use a separate protocol adapter and clearly identify the connection as unencrypted.
- [ ] **F57 — Mosh (deferred, revisit on demand):** Revisit when users need remote terminal sessions that survive network changes or brief outages. Investigate client integration, server requirements, and packaging at that point.
- [x] **F58 — Cryptography (implementation):** Document bundled SSH algorithm defaults and report key exchange failures for target sessions, jump hosts, and public-key installation. All seven F58 regressions passed on Linux x64. See `docs/SSH_SESSIONS.md`.

Completion criteria: Publish prerequisites and platform support. Test tunnel conflicts, denied forwarding, multi-hop failures, hardware access, and unsupported algorithms. Do not implement custom cryptographic primitives.

## Phase 7 — Accounts and encrypted synchronization

Dependencies: Stable data model, secure storage, migrations, and key-management design. Introduces the online backend.

- [x] **F59 — Accounts (implementation):** PostgreSQL-backed registration with email verification, sign-in, per-installation devices and sessions, and current-session sign-out in Settings. Account service is optional. Tests written for the Phase 7 gate. See `docs/ACCOUNTS.md`.
- [x] **F60 — Account protection (implementation):** Authenticator MFA, single-use recovery codes and email password reset, PostgreSQL-backed rate limits, and revocation of other sessions. Tests written for the Phase 7 gate. See `docs/ACCOUNTS.md`.
- [x] **F61 — Encrypted sync (implementation):** Local key generation, client-side encryption for workspace metadata, versioned per-account snapshots with revision checks, and explicit additive publish and merge. Regressions written for the Phase 7 gate. See `docs/WORKSPACE_SYNC.md`.
- [x] **F62 — Offline editing (implementation):** Explicit workspace publication persists an encrypted, account-scoped batch before network access. Reconnection retries it while the app holds the entered key. The batch survives restart and supports manual retry or confirmed discard. Tests written for the Phase 7 gate. See `docs/WORKSPACE_SYNC.md`.
- [x] **F63 — Conflicts (implementation):** Review competing records and select updates or deletes in either copy. Stale approvals are refused. Version 2 uses deletion markers to block accidental resurrection and the service rejects format downgrades. Regressions written for the Phase 7 gate. See `docs/WORKSPACE_SYNC.md`.
- [x] **F64 — Sync preferences (implementation):** Per-device, account-scoped controls for metadata and SSH credentials. Credentials default off and transfer manually from an unlocked vault into a separate encrypted catalog. Restore preserves existing local credentials. Tests written for the Phase 7 gate. See `docs/WORKSPACE_SYNC.md`.
- [x] **F65 — Device identity (implementation):** Rename or retire account devices and allow retired installations to sign in again. Publish, copy, rotate, or remove managed SSH public keys in an optional account-private directory. Tests written for the Phase 7 gate. See `docs/ACCOUNTS.md`.

Completion criteria: Define behavior for device loss, conflicting changes, offline deletion, key rotation, recovery, and revoked devices. Preserve unsynced changes. Obtain security review before claiming end-to-end encryption.

Removing a directory entry does not revoke public keys already installed on remote servers.

## Phase 8 — Teams and collaboration

Dependencies: Phase 7 with reviewed authorization and encryption boundaries.

- [x] **F66 — Organizations (implementation):** Create organizations, invite verified accounts through an in-app inbox, accept or decline, transfer ownership, and remove members. Server checks account sessions and ownership on every operation. Tests written for the Phase 8 gate. See `docs/ORGANIZATIONS.md`.
- [x] **F67 — Shared vaults (implementation):** One revisioned encrypted vault per organization. Owners publish host and identity profiles, snippets, and portable settings. Members with the key can preview and explicitly import categories. Regressions written for the Phase 8 gate. See `docs/SHARED_VAULTS.md`.
- [x] **F68 — Permissions (implementation):** Create multiple named vaults and manage restricted or organization-wide Reader access and per-member Reader or Editor grants. Existing F67 vaults keep their key and data. Server authorization applies to current and legacy routes. Regressions written for the Phase 8 gate. See `docs/SHARED_VAULTS.md`.
- [x] **F69 — Shared logs (implementation):** Share completed recordings into a vault with encrypted output and annotations, Reader and Editor access, owner removal, and automatic 30-day expiry. Regressions written for the Phase 8 gate. See `docs/SHARED_LOGS.md`.
- [x] **F70 — Multiplayer (implementation):** Invite-only live viewing, encrypted output and input, one-device typing grants, host take-back, viewer hand-back, and revocation. Tests written for the Phase 8 gate. See `docs/LIVE_TERMINAL.md`.
- [x] **F71 — Administrative events (implementation):** Owner-only history for membership, permissions, and vault management. Events commit with the changes they describe. Tests written for the Phase 8 gate. See `docs/ADMINISTRATIVE_EVENTS.md`.

Completion criteria: Verify authorization through both UI and API. Revocation stops future sync and live-session access. Server-side credential revocation remains a separate offboarding responsibility.

## Phase 9 — AI integrations and commercial features

Planned after the first release.

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

Use this checklist for each platform and feature included in a release.

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
- [ ] Resolve remaining release-blocking failures and verify enabled online features against PostgreSQL.
- [ ] Install and upgrade the exact release package, then verify the public download and installation guide.

## Definition of verified completion

Implementation checkboxes track delivered code, as requested; they do not replace the phase verification gate. Before declaring a phase verified, confirm for its features that:

1. Intended behavior is implemented.
2. Relevant success and failure paths are verified.
3. Resources and data are cleaned up safely.
4. Errors explain what happened and what the user can do.
5. Material limits are documented.
6. Validation evidence identifies the operating systems checked.

## Verification status

| Scope | Last recorded evidence | Remaining work |
| --- | --- | --- |
| Phases 0–3 | Linux unit gates passed with 37, 86, 113, and 133 tests respectively. Desktop verification was blocked by Chromium sandbox setup in those runs. | Recheck desktop workflows on a supported host. |
| Phase 4 | SFTP and transfer recovery regressions were written. | Verify live SSH/SFTP, transfers, cancellation and recovery. |
| Phase 5 | User verified workspace and productivity features on Linux. A packaged Linux x64 build launched and ran a shell. | Verify the exact first-release package. |
| Phase 6 | Linux unit suite reported 389 passed and 5 failed. The sandbox-enabled desktop suite reported 59 passed, 19 failed, and 1 skipped, plus a teardown timeout. Desktop smoke and all seven focused SSH crypto tests passed. | Triage the failures, then verify live proxy and SSH workflows and serial hardware. |
| Phase 7 | Account and encrypted sync tests were written. | Verify migrations with PostgreSQL, SMTP, account recovery, and cross-device sync. Authorization and encryption review is open. |
| Phase 8 | Team and administrative history tests were written. Static checks and the build passed at F71. | Verify team permissions, revocation, live terminal sharing, and audit history with separate accounts. |
| macOS and Windows | Only Linux Debian packaging is configured. | Build, sign as required, and verify installers before publishing either platform. |

The Phase 6 unit failures covered HTTP CONNECT buffered data, missing serial-device errors,
session log checkpoints, SSH agent credential validation, and the transfer recovery save mock.
Desktop failures covered the preload bridge, reload and navigation, SFTP recovery and drag-and-drop,
terminal interactions, SSH dialogs, and session recording. Several SSH cases stopped at reload.

Per-feature implementation logs and earlier verification details remain in Git history.

## References

These references informed the plan. Check current dependency versions and behavior when implementing a feature.

- [Termius features](https://www.termius.com/pricing)
- [Termius documentation](https://docs.termius.com/)
- [Electron](https://www.electronjs.org/docs/latest/)
- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security)
- [xterm.js](https://xtermjs.org/)
- [node-pty](https://github.com/microsoft/node-pty)
- [ssh2](https://github.com/mscdex/ssh2)
