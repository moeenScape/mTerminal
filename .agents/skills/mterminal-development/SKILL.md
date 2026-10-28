---
name: mterminal-development
description: "Implement, fix, or review mTerminal Electron and TypeScript features, including React integration, IPC, PTY sessions, SSH/SFTP, local storage, and cross-platform packaging. Use for application code or build changes in this monorepo."
---

# mTerminal Development

## Locate the feature and its boundaries

Read the applicable `AGENTS.md`, repository [README](../../../README.md), relevant [roadmap](../../../DEVELOPMENT_ROADMAP.md) IDs, package manifests, and the code being changed. Inspect callers and cleanup paths when fixing a bug. Do not assume npm scripts, dependencies, or application entry points exist just because documentation proposes them.

Build the requested feature completely with the smallest compatible change. Use existing helpers and installed packages before adding dependencies or abstraction layers. Preserve unrelated work. Follow the established formatter/linter; when configuring the first toolchain, enable strict TypeScript, document runtime versions and commands, and keep one root npm lockfile.

## Respect the monorepo and process model

- `apps/desktop/src/main/`: lifecycle, validated IPC handlers, PTY/SSH connections, storage, and privileged operations.
- `apps/desktop/src/preload/`: a narrow typed `contextBridge` API. Do not expose raw Electron IPC, arbitrary channel names, shell execution, or filesystem APIs.
- `apps/desktop/src/renderer/`: React interface and xterm.js. Keep credentials and privileged implementation code out of this process.
- `apps/desktop/src/shared/`: serializable desktop IPC contracts. `packages/shared/` is for contracts actually used across applications, not a catch-all for desktop helpers.
- `apps/server/` and `packages/shared/`: leave unimplemented until authorized work requires them. Local terminals and SSH do not need a cloud backend.

Keep renderer isolation and sandboxing enabled and Node integration disabled. Validate IPC sender identity, payloads, session ownership, and permitted operations at the privileged boundary; TypeScript types alone do not validate runtime input. Constrain navigation, external links, and new windows. Consult current official Electron documentation for version-sensitive security or native-module behavior.

## Handle terminal resources deliberately

Give each session one clear owner. Handle input, resize, exit, cancellation, connection failure, and disposal. Remove listeners and close processes/channels on tab close, window shutdown, and failed setup. Guard against late callbacks updating a disposed session.

Batch terminal output with bounded queues and backpressure. Do not route every output chunk through React state or persist unlimited scrollback/logs. Keep blocking I/O and expensive work off the Electron main event loop. Pass local executable arguments separately instead of interpolating values into shell command strings.

SSH must verify server fingerprints and surface changed keys. Make reconnection explicit about session loss; never silently replay prior commands. For transfers, preserve the original where possible, report partial writes, and implement resume only when verified against the server behavior.

## Preserve stored data and secrets

Store runtime records under the application's data directory. Use reviewed secure credential storage; refuse silent plaintext fallback when a platform keychain is unavailable. Keep secrets out of ordinary database records, diagnostics, crash reports, and default exports.

Use transactions for related writes and versioned migrations with tested failure recovery. Validate imports and expose the scope of deletion or overwrite. Do not confuse account access, vault permissions, and remote server privileges. Hardware keys, certificates, Mosh, and algorithm support require compatibility evidence before promising support.

## Verify and report

Use the actual package scripts for formatting, linting, type checking, build, and relevant tests. Add focused checks for nontrivial behavior, especially invalid IPC, lifecycle cleanup, authentication failure, and interrupted writes. Tests should demonstrate outcomes rather than duplicate implementation details. Avoid unrelated suites when bounded verification resolves the change.

For runtime changes, exercise the feature where the environment permits it. Record which OS/architecture was checked; do not infer Windows/macOS support from a Linux build. When native modules or packaging change, check their Electron ABI and target-architecture compatibility.

Update README commands when changing the toolchain and record completed roadmap IDs with evidence. Distinguish source inspection, automated checks, visual inspection, and live runtime verification. Report the resulting behavior and material limitations without overstating coverage.
