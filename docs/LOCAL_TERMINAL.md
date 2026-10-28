# Local terminal: F07–F12

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
Closing a tab stops its PTY; reloading or destroying the window stops all owned PTYs.
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
  backpressure, exit and disposal. Up to 16 independent sessions are allowed per application window.
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

## Input, output, and keyboard handling (F09)

Text input—including committed IME text and xterm-generated control sequences—uses
`onData`. Input is split into at most 65,536 UTF-16 code units per IPC message,
without cutting a surrogate pair. Enter, arrows, Tab, Escape, Backspace and Ctrl
combinations are encoded by xterm and passed through rather than rebuilt by the
application. Binary `onBinary` reports use a separate tagged payload; the main
process validates eight-bit characters and creates a byte Buffer using Latin-1.
Both forms require the owning renderer frame and the current session ID.

Node-pty's default UTF-8 output decoding feeds raw text to xterm's streaming VT
parser; partial ANSI sequences survive separate batches. xterm processes output
before its acknowledgement releases PTY backpressure. Text/control output is not
inserted as HTML, logged or put in React state. Use a UTF-8 shell/program locale;
legacy output encodings are not automatically detected or converted.

The pinned Unicode 11 addon provides character-width tables for wide and combining
characters. It requires xterm's proposed Unicode API, enabled only inside the
renderer terminal instance. Font coverage, Bengali/other complex-script shaping,
modern emoji ZWJ clusters and OS-specific IME behavior need native visual checks;
Unicode 11 widths alone do not guarantee those rendering outcomes.

### Application shortcuts

On Linux/Windows native menus use Ctrl+Shift for conflicting actions:

| Action | Shortcut |
| --- | --- |
| Copy / Paste / Cut | Ctrl+Shift+C / V / X |
| Select all | Ctrl+Shift+A |
| Undo / Redo | Ctrl+Shift+Z / Y |
| Close window / Quit | Ctrl+Shift+W / Q |
| Development reload | Ctrl+Shift+R |
| Minimize | Ctrl+Shift+M |
| Fullscreen | Ctrl+Shift+F11 |

macOS retains its Command-based native menu roles. Unshifted Ctrl combinations
are available to the shell according to its keymap, including Ctrl+C interruption,
Ctrl+W word deletion and Ctrl+R history search. Ctrl+Alt+1/2/3, when enabled in
Settings, navigates the app without sending the same key to the PTY. Composition
and AltGr events are excluded from navigation. Clipboard confirmation policy is
still F12; full-screen application and platform keyboard checks remain pending.

F09 tests cover text/emoji chunk boundaries, binary byte preservation, VT output
across batches, invalid payload rejection, menu mapping and composition guards.
A Bash E2E fixture checks Unicode/ANSI output and shell control keys; its Windows
counterpart still needs compatibility work. These tests are written and
type-checked, not executed until Phase 1 completion. Build/static checks pass;
interactive, IME, visual and Windows/macOS verification remain pending.

References: [xterm input events](https://xtermjs.org/docs/api/terminal/classes/terminal/#onbinary),
[Electron accelerators](https://www.electronjs.org/docs/latest/tutorial/keyboard-shortcuts).

## Resizing (F10)

`TerminalSizing` is the single owner of the renderer grid. FitAddon proposes rows
and columns from the available terminal container; the controller applies the
shared bounds to both xterm and the PTY notification (2–500 columns, 1–300 rows).
Large windows can leave unused space at those limits. The emulator is no longer
allowed to grow beyond the PTY's dimensions.

Container/window resize, font readiness/loading, display-scale changes and view
activation schedule one update per animation frame. Unchanged dimensions produce
no extra IPC update. A hidden/zero-size container or unready/invalid measurement
does not resize the PTY to zero. Reopening Workspace schedules a fresh fit.
Background output never changes keyboard focus. Observer, font, media-query and
window listeners are removed on disposal, and late frames are ignored.

Starting a session requires a measurable grid. If layout is not ready, wait for
fonts or resize the window and try Start again. While the shell is opening, the
main process remembers the newest grid instead of discarding resize requests.
The new PTY receives that grid; after open, a forced renderer resync and later
layout notifications catch any remaining change. Active-session resizes are
validated and deduplicated. Resizing neither creates another shell nor replays
commands or input.

Tests cover coalescing, clamping both grids identically, invalid/hidden layouts,
restoration, forced sync, disposal, resize-during-open, duplicate suppression and
cancelled opening identity. A Unix Bash/stty fixture compares actual PTY size to
xterm's cursor-position report after large/small/hidden-view transitions. These
checks are written and type-checked but not run until Phase 1 completion. Windows
ConPTY, native display scaling/zoom, font rendering, Vim/tmux and full-screen
compatibility remain unverified. F11 now provides tabs; its runtime verification is also pending.

## Terminal tabs (F11)

Workspace starts empty. **Start local shell** or **New terminal** creates a tab;
the selected new tab starts its shell when its pane is visible and measurable.
If creation is switched away from before startup begins, selecting that tab starts
it. Use a tab label to switch. Inactive panes stay mounted and continue parsing
and acknowledging output, preserving scrollback without routing it through React.
A newly completed background startup does not steal focus from another tab or a
dialog. The footer reports running sessions, not a fixed count.

Tabs display their name and Ready/Starting/Running/Exited/Error status. Double-click
or **Rename** opens a dialog; names must be nonblank and at most 64 UTF-16 units,
with no control characters. Renaming changes only the label. Drag to another tab
or use **Move left/right** to reorder without remounting its terminal or PTY.

Keyboard controls in the terminal tab strip:

| Key | Action |
| --- | --- |
| Left/Right, Home/End | Select a tab and keep keyboard focus in the strip |
| F2 | Rename the focused tab |
| Delete | Close the focused tab |
| Alt+Shift+Left/Right | Move the focused tab one position |

The close button or **Close session** removes the tab. A running or starting tab
first opens a modal confirmation naming it and warning about interrupted work and
discarded output. Cancel/Escape preserves it. Closing an exited/error/idle tab is
immediate. Closing the selected tab chooses the next available neighbor; closing
another tab preserves selection. Exit/error output remains visible until the tab
is closed, or **Start local shell** explicitly starts a fresh session in that tab.

Names, ordering and scrollback are in memory only. There is no session restoration
or command replay. Window close/reload ends all sessions; broader quit/process-tree
behavior still needs F15. Tabs and backend PTYs both have a fixed limit of 16;
close existing tabs to create more. Existing per-session buffer/scrollback/grid
limits remain in force. Concurrency performance still needs F16 measurements.

The main process owns a separate single-session manager per session ID. Input,
resize and acknowledgements route only to that ID after the existing main-frame
checks. Duplicate IDs cannot overwrite an active entry. Natural exit frees a
backend slot. Close/reset/dispose release PTYs, listeners and pending creations;
a late process from a cancelled opening is killed rather than attached elsewhere.
No tab name, command or output is added to diagnostic logs or SQLite.

Tests cover tab actions, invalid names/moves/IDs, neighbor selection and limits;
backend input/resize/close isolation, duplicate rejection, slot release and late
cancellation; and desktop creation, output separation, rename, reorder, keyboard
navigation, dialog behavior and close confirmation. They are written/type-checked
but not run until Phase 1 completion. Pointer drag behavior, native focus,
concurrent interactive sessions, visual layout and Windows/macOS remain unverified.
F12 clipboard handling is implemented below; native verification remains pending.

## Clipboard (F12)

Select terminal output with xterm's normal mouse selection, then choose **Copy
selection**. The button is disabled without a selection. **Select all** selects
the terminal buffer, including available scrollback. Copy also works after a
shell exits, while its tab/output is retained. Copying does not remove output.
Only plain text is copied; HTML/images/formats and clipboard history are not added.

Use **Paste**, native Edit-menu Paste, or Ctrl+Shift+V on Linux/Windows and
Command+V on macOS. Copy uses Ctrl+Shift+C or Command+C. Ctrl+C remains shell input.
Native copy/cut/paste events are handled inside the terminal container; other
application inputs keep their normal editing behavior. Terminal Cut copies its
selection without deleting terminal output. Toolbar controls provide accessible
alternatives to the shortcuts. Linux primary-selection/middle-click behavior is
not a separately implemented or verified feature.

### Paste review and binding

An empty clipboard sends nothing. Single-line ordinary text is passed to
`xterm.paste`; it does not append an Enter key. CRLF and lone CR normalize to LF
before xterm performs terminal newline conversion and bracketed-paste wrapping
when the receiving application has enabled that mode. No automatic fallback to
a different session or replay occurs.

A newline anywhere, even at the end, or a control character requires confirmation.
The native modal names the destination tab and warns that commands may run. Its
preview escapes nonprinting controls and shows at most 8 Ki source UTF-16 units,
without splitting an emoji. A truncated preview explicitly says that the full
text would be pasted. Cancel/Escape sends nothing. The full text remains transient
only while pending; it is not saved as a snippet, database record, or log.

Both asynchronous reads and confirmation retain the captured terminal/session.
The session must still be ready, visible and the same instance when text is sent.
An exited/replaced target discards the request. Paste before shell readiness is
refused. App navigation shortcuts cannot bypass the open modal. Paste review is
required even when bracketed-paste mode is enabled; that mode depends on the shell
or application and is not treated as a reason to skip review.

### Boundaries and verification

Clipboard IPC validates the owning main frame and focused window. OS reads are
revalidated after their asynchronous completion. Text transfers are limited to
1 Mi UTF-16 units. Empty selection does not issue an app clipboard write. Errors
use fixed messages/codes; no clipboard data or previews enter diagnostics. OSC 52
requests in terminal output are consumed without invoking clipboard APIs. Commands
run by the user may still use OS utilities directly; this is not a shell sandbox.
The OS controls the clipboard after a user copy; the app does not clear it on quit.

The new unit tests mock OS IO and cover limits, previews, newline/control handling,
IPC identity, asynchronous focus loss and sanitized failures. Desktop tests use
mock clipboard methods/synthetic paste events rather than the real OS clipboard,
and cover selection copy, cancel/confirm, and rejecting an exited destination.
They are written and type-checked but not executed until Phase 1 completion.
Native shortcuts, real OS clipboard permissions, platform focus, rendering and
Windows/macOS compatibility remain unverified. F13 search/scrollback is next.

References: [Electron clipboard API](https://www.electronjs.org/docs/latest/api/clipboard),
[xterm paste](https://xtermjs.org/docs/api/terminal/classes/terminal/#paste).

## Search and scrollback (F13)

Each terminal tab has its own literal search and query. Search is case-insensitive by default; Match case changes it. Ctrl+Shift+F or Command+F opens search, Enter/Shift+Enter navigate, and Escape closes it. Search queries are limited to 256 UTF-16 units. Highlights are capped at 1,000; the displayed count says “at least” at the cap. Bottom returns to live output. Scrollback keeps 3,000 lines per tab plus the visible screen; older lines are discarded. Queries and output remain in memory and are not logged. Regex search, persistence, native visual checks and phase tests remain pending.
