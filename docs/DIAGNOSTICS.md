# Diagnostics and troubleshooting

## What is recorded

mTerminal writes `logs/diagnostics.log` under its Electron user data directory.
Each JSON line contains a timestamp, a fixed event name, and optionally a fixed
failure code. The file rotates at 256 KiB and keeps one previous file
(`diagnostics.log.1`), bounding normal application logs to 512 KiB total.
New log files use Unix mode `0600`; Windows uses the directory ACLs.

Logs deliberately omit exception messages/stacks, filesystem paths, environment
variables, preferences, shell input/output, credentials, and IPC payloads. There
is no automatic upload. Review any files before sharing them. These guarantees
apply to mTerminal's diagnostic files; Electron, Node, and development tools can
write their own console output. If logging fails, the application uses a fixed
console notice and startup errors report that diagnostics are unavailable.

## Recovery actions

Startup dialogs show the fixed failure code, recovery action, and local data
location. Raw exceptions are never placed in those dialogs or diagnostic files.

| Code | Action |
| --- | --- |
| `database-locked` | Close the app and maintenance processes. Inspect a stale lock only after verifying no owner is running; follow [storage recovery](LOCAL_STORAGE.md). |
| `database-invalid` | Preserve the database and journals; use a matching app version or restore a validated backup. |
| `database-open` | Check the data directory and disk space; preserve existing files before recovery. |
| `preferences-invalid` | Quit, back up `preferences.json`, then repair or move it aside. Moving it aside resets preferences, not the SQLite database. |
| `preferences-save` | Unsaved values remain in the form. Fix directory access or disk space, then retry Save. |
| `permission-denied` / `disk-full` | Correct access or free space, then retry; do not remove application records. |
| `backup-unsupported` | Use a filesystem supporting hard links for the data/backup directory. |
| `renderer-load` / `renderer-crashed` | Restart; rebuild or reinstall if interface loading repeatedly fails. Preserve user data. |
| `unexpected` | Restart and report the fixed event code. Keep the original data files. |

A failed window-state save keeps the window open and reports a recovery action.
Remember window size can be disabled to close without saving that state. A hung
interface records `renderer-unresponsive`; wait for it to recover before deciding
to restart. Neither crashes nor failures automatically delete or restore data.

## Phase 0 validation

Run from the repository root on the supported Node 24 version:

```bash
npm run check
npm test
```

37 unit tests pass on Linux/Node 24.12.0, covering IPC validation, navigation
policy, preference persistence, database recovery, error classification, and log
privacy/rotation/failure. Production compilation also passes.

The final desktop suite has 10 tests and explicitly requests Chromium sandboxing.
Its first launch is blocked in this environment by the invalid chrome-sandbox
helper ownership/mode; the remaining nine tests were not run (fail-fast).
An earlier run using Playwright's default sandbox-disabled launch found reload
and test/label issues, which were fixed. That run is not a security pass.
Do not bypass sandboxing to obtain a passing result. An administrator must provide
a supported sandbox configuration on the machine running the tests. No system
permissions were changed by this implementation. Desktop visual review, native
failure dialogs, and Windows/macOS verification remain pending.

E2E fixtures create and remove temporary profiles, avoiding normal user data.
For an isolated development profile, set `MTERMINAL_USER_DATA` to an existing
absolute directory before `npm run dev`; packaged apps ignore this override.

Implementation references: [Electron navigation events](https://www.electronjs.org/docs/latest/api/web-contents#event-will-frame-navigate),
[SQLite result codes](https://www.sqlite.org/rescode.html).
