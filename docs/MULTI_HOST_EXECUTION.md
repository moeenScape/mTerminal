# Multiple-host execution

Connect the SSH hosts you want to use from Hosts. Open **Run on hosts** (the server button
beside Workspace templates) in the session strip. This opens Workspace when necessary.

## Select, review and execute

1. Refresh destinations. Choose individual connected accounts or Select all connected.
2. Enter a command or multiline script, up to 4,096 characters.
3. Click **Review batch**. Check the full command, usernames, addresses, ports and verified
   server fingerprints. Cancel sends nothing.
4. Click **Run batch** to start the reviewed destinations once.
5. Inspect each host's status, exit code/signal, standard output and standard error.

The app reuses authenticated SSH clients from existing terminal sessions. It does not open
new connections, request passwords or bypass host-key checks. Equivalent connections to the
same address, port, username and fingerprint appear once; different accounts remain separate.

Each command uses a new non-interactive SSH exec channel. It does not inherit the interactive
terminal's current directory or shell variables. Include required `cd` and environment setup
in the command. Standard input closes immediately; commands requiring prompts or a terminal
should be run in their terminal pane. Server permissions may forbid exec even when SSH shell
access works. Startup snippets are not run by command batches.

## Limits and results

One batch runs at a time, with up to 16 destinations and three concurrent commands. Each host
has a 60-second timeout and a combined 64 KiB stdout/stderr capture limit. Reaching either
limit closes that exec channel and retains partial output. Other destinations continue.

A successful result requires a confirmed zero exit status and a closed channel. Nonzero
statuses, signals, rejected execution and closes without an exit status are not success.
Disconnected, cancelled, timed-out and output-limited hosts have distinct statuses. A batch
finishing does not mean every host succeeded.

Reviews expire after 60 seconds and are consumed on a start attempt. Every reviewed target
must still have the same session and verified identity before starting; otherwise no command
is sent. Queued destinations are checked again before execution. A failed host is never
reconnected or retried, and execution is not redirected to another connection. A client with
an unacknowledged exec request/channel refuses another command until it closes or that SSH
connection is replaced; cancelled requests cannot accumulate unbounded channels.

## Cancellation and lifetime

**Cancel batch** stops queued commands and closes running exec channels, retaining completed
results and partial output. Closing an SSH terminal disconnects its exec channels. Remote
processes may survive channel closure, timeout, cancellation or disconnection; inspect the
server before deciding whether to run anything again. An in-flight request may already have
reached the server even if cancellation arrives before its acknowledgement. There is no
rollback or automatic retry.

Closing the panel keeps an approved batch running. Reopen Run on hosts to see it. Starting a
new batch replaces the previous in-memory results. Commands, previews and output are not
written to disk, diagnostic logs, command history or workspace exports. Closing the window,
renderer reload or crash cancels local work and discards results. Window close warns while a
batch is active. Vault lock hides the panel but does not cancel already approved work on
existing SSH clients.

## Verification boundary

Regression code covers request/sender validation, one-use/expired reviews, target identity
changes, concurrency, cancellation, reset, bounded UTF-8 output, timeout, missing exit status,
late channel cleanup and per-host UI results. Tests remain unrun at the user's request.
Real SSH interoperability, remote-process cancellation, native/visual behavior and
Windows/macOS acceptance remain pending.
