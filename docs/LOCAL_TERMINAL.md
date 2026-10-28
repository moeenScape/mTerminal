# Local terminal: F07–F08

## Run and use

From the repository root:

```bash
npm install
npm run dev
```

Open Workspace and click **Start local shell**. Type commands normally. The shell
starts in your home directory and inherits the application's environment except
internal Electron/test variables and `NODE_OPTIONS`. It runs with your user
permissions. Switching Hosts/Workspace/Settings preserves the session and output.
Closing the session, reloading the window, or destroying the window stops the PTY.
Closing a session can interrupt foreground work; it never replays commands.

## Platform defaults (F08)

A valid explicit override always wins. For automatic selection, candidates are
checked in this order; missing, inaccessible and non-file entries are skipped:

| Platform | Selection order |
| --- | --- |
| Linux | Valid `$SHELL`, `/bin/bash`, `/usr/bin/bash`, Zsh, sh, then remaining `/etc/shells` entries and fish |
| macOS | Valid `$SHELL`, `/bin/zsh`, `/bin/bash`, `/bin/sh`, then remaining `/etc/shells` entries and fish |
| Windows | PowerShell 7 under Program Files, `pwsh.exe` in absolute PATH directories, system Windows PowerShell, ComSpec, system cmd |

Windows ignores Unix `SHELL`. Empty/relative PATH directories are not searched;
candidate paths are deduplicated without case sensitivity. On Unix, false/nologin
are excluded. There is no automatic retry with another shell after spawn fails.

Settings accepts only an existing file with Unix execute access, or a fully
qualified `.exe`/`.com` path on Windows. Paths containing spaces are supported as
one executable path; do not add arguments, environment expansions, or surrounding
quotes. Relative and Windows current-drive-relative paths are rejected. Changing
this setting affects new sessions and does not interrupt the current terminal.

Save-time validation preserves prior preferences if rejected. Launch revalidates
the saved path in case it has since moved or lost permissions. Invalid overrides
show `shell-invalid` and never silently fall back. Clear the field to return to
automatic selection. When no automatic candidate is usable, `shell-missing`
explains installation or override options. Discovery checks file/access metadata;
a damaged executable or unsupported binary can still fail when spawned.


## Process and data boundaries

- Main process: executable checks, PTY ownership, input, resize, output batching,
  backpressure, exit and disposal. One session is allowed per application window.
- Preload: fixed typed terminal operations and a disposable event subscription.
  Main-frame identity, session IDs, payload lengths and grid sizes are validated.
- Renderer: xterm.js and FitAddon; output bypasses React state. The terminal stays
  mounted across navigation. Late callbacks ignore cancelled/replaced sessions.

Output batches every 16 ms, pauses at 256 Ki UTF-16 characters pending, and resumes
below 64 Ki. A 1 Mi-character hard limit stops overflow rather than silently losing
output or growing memory indefinitely. The renderer acknowledges output only when
xterm has parsed it. Scrollback is limited to 3,000 lines. Input IPC chunks are at
most 64 Ki characters; PTY dimensions are limited to 500 columns by 300 rows.
Session output/input is not persisted in SQLite or written to diagnostics.

## Native modules and failures

The install hook rebuilds node-pty with `@electron/rebuild` against the installed
Electron version. After changing Electron, CPU architecture, or reinstalling
native dependencies, run:

```bash
npm run rebuild:native
```

Ubuntu builds may need Python 3, make and a C++ compiler (`build-essential`). macOS
needs Xcode command-line tools; Windows needs a supported MSVC C++ toolchain and
Windows SDK. Perform builds on each target OS/architecture; a Linux build does not
provide Windows/macOS artifacts. Packaging/unpacking native binaries is later work.

On startup failure, verify the shell path in Settings and rebuild native modules.
A stopped/overflowed session shows an explicit status and can be started again.
Logs contain fixed terminal failure codes, never commands, shell paths, or output.

## Verification and remaining scope

Static checks and production compilation pass. node-pty loads under the installed
Electron on Linux x64 (Node 24.22.1, ABI 150). This is a native-load check only,
not an interactive PTY compatibility pass. The new tests cover batching, pause/
resume, ownership, resize, exit ordering, cancellation, overflow, request limits,
and a real-shell desktop workflow. They are written but deferred until Phase 1
completion. Sandbox-enabled desktop verification remains blocked by the host
configuration documented in [diagnostics](DIAGNOSTICS.md).

Full-screen programs, Unicode/IME, Windows ConPTY, macOS, clipboard/multiline-paste
policy, process-tree/orphan behavior, many sessions, performance tuning and
packaging still need their later roadmap steps and compatibility checks. Tabs,
splits, SSH, and host management are not part of F07.

References: [node-pty](https://github.com/microsoft/node-pty),
[xterm flow control](https://xtermjs.org/docs/guides/flowcontrol/),
[Electron native modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules).

F08 policy and availability tests cover platform ordering, missing defaults,
case-insensitive Windows deduplication, path constraints, explicit override
precedence and missing/permission/directory failures. An E2E regression covers
rejecting an unavailable override without replacing saved preferences. These
checks are written and type-checked but not executed until Phase 1 completion;
no Windows/macOS runtime pass is claimed.

Platform references: [PowerShell Windows installation locations](https://learn.microsoft.com/en-us/powershell/scripting/install/install-powershell-on-windows),
[macOS default shells](https://support.apple.com/en-us/102360).
