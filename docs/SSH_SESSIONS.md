# SSH terminal sessions

Create a saved SSH profile in Hosts. Group defaults supply port and username only
when the corresponding inheritance flags are enabled. Choose **Connect** to open
a terminal tab, then provide the SSH username and authentication details. The
expected fingerprint field is optional; supplying it requires an exact match even for a saved key.
Choose Password, Private key or Keyboard-interactive. Private key mode reads a
file you explicitly select (at most 256 KiB); enter its passphrase if encrypted.
The key is not copied into application storage. Supported key formats depend on
ssh2; invalid keys or incorrect passphrases fail with a fixed connection error.
Agents and hardware-backed keys are not yet supported.

Password and key modes can optionally continue with keyboard-interactive
challenges, for example an OTP required after primary authentication. Each round
shows the target tab, server instructions and prompts. Secret responses are
masked; prompts requesting echo use ordinary text fields. Cancel connection
ends the authentication attempt. Answers are bound to the current session and
challenge token; stale replies cannot answer a later challenge. Up to eight
prompts are accepted per round, each answer is limited to 4,096 characters, and
each round expires after 60 seconds. Zero-prompt rounds are answered automatically.

Obtain the SHA256 host-key fingerprint from the server administrator through a
trusted channel. On the server, an administrator can inspect a public host key:

```sh
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub -E sha256
```

For an explicit pin, enter only the `SHA256:...` portion, for the host key
actually offered by the server. Other key types have their own public-key files.
Do not copy an unverified fingerprint from the network into this field: the supplied value is the trust
anchor. A mismatched key refuses the connection before password authentication.
Unknown keys open an identity confirmation before authentication. Choose Trust
and save key only after verifying the presented fingerprint through a trusted
channel. Trust is saved in SQLite by normalized address (lowercase and outer IPv6
brackets removed) and port, shared across profiles using that endpoint. Profile
deletion does not remove trust. These records are independent of OpenSSH's
`known_hosts` file; import/export is not implemented.

A changed key displays the saved and presented fingerprints. The current attempt
will always be refused. To approve a legitimate rotation, verify the new key with
the administrator, type the complete new fingerprint, and choose Replace saved
key and cancel connection. Start a new connection afterward. Any supplied explicit
pin must also match the new key. Concurrent/stale approvals cannot overwrite a
newer trust decision. One key is tracked per endpoint; negotiation of another
server key algorithm also produces a change warning.

Passwords, private keys, passphrases and challenge answers are held in memory
for the connection attempt/session and are not stored in SQLite, preferences,
diagnostics, or tab records. JavaScript strings cannot be reliably zeroed; this
is not a memory-erasure guarantee. Approved fingerprints are retained in the
known-host table. Host edits affect new connections.

The remote terminal supports text/binary input, resizing, search, clipboard and
appearance controls through the same workspace as local terminals. Closing a tab
closes its SSH channel and connection; it cannot guarantee that detached remote
processes stop. Output remains capped by the existing scrollback and pending-data
limits. Shell exit retains displayed output. Reconnect is explicit and never
replays commands. Connection progress comes from the main process: Connecting, Verifying key,
Authenticating, Opening shell and Connected. Connected is reported only after
both the channel and terminal owner are ready. Setup rejection displays Failed
with a fixed error message. Shell/channel or network close displays Disconnected
with its exit code (255 when no exit status is available); transport errors after
connection display Failed. Output remains visible, input/paste is disabled, and
Reconnect SSH starts a fresh attempt. Active verification/authentication tabs still
require close confirmation. Connected SSH tabs contribute to the session count.
Local terminal statuses retain their existing behavior.

The desktop flow allows up to 120 seconds for handshake/overall setup, including
identity confirmation and interactive authentication; each confirmation expires
after 60 seconds. Direct pinned transport use without prompts retains its shorter
15-second handshake/20-second setup limits. Rejection, expiry and cancellation
close the attempt and do not save unknown keys. Wrong credentials and network
failures produce fixed error messages.

Implementation reference: [ssh2 client and channel API](https://github.com/mscdex/ssh2#api).
Trust policy tests cover persistence, pins, changes, rotation, cancellation and
concurrent decisions; desktop trust dialogs use an IPC fixture. Loopback server
tests cover asynchronous key verification and password/key authentication, encrypted keys, invalid
passphrases and multiple interactive rounds. Challenge broker tests cover reply
ownership, cancellation and expiry. These and desktop prompt tests are deferred
until the Phase 2 gate. Live OpenSSH, interactive program and Windows/macOS checks remain
pending. The existing Electron sandbox issue blocks desktop validation here.

F22 tests cover progress ordering, session ownership across progress/replacement,
final-output-before-exit delivery and active close guards. Desktop lifecycle tests
use an isolated IPC fixture for both disconnection and runtime failure. These
tests remain deferred until the Phase 2 gate. No live networking or visual pass
is inferred from the static/build checks.

## Keepalive and reconnect

SSH connections send a keepalive request every 15 seconds. Three unanswered
requests are allowed; the next interval closes the transport (normally about
60 seconds without replies, subject to scheduling). The terminal reports that
the server stopped responding, marks the session Failed, disables input/paste
and keeps the displayed output. Probes use ssh2 protocol requests, not shell
commands. Ordinary remote shell exit still reports Disconnected.

Reconnect SSH is available only after an attempt ends. It opens a fresh
authentication dialog with no retained password, private key, passphrase or
challenge answers, and uses the current saved profile/group defaults. Saved
endpoint trust and any newly supplied pin are verified again. Confirming the
dialog clears displayed output and starts a new session with a new ID; it does
not resume the old shell or replay input. Cancelling the dialog preserves output
and starts no connection. Switching views never triggers an automatic reconnect.

The loopback test includes a proxy that stops forwarding SSH traffic and an
accelerated interval clock to exercise keepalive loss. A desktop IPC fixture
covers fresh credentials, cancellation, new IDs and absence of input replay.
These tests are written/type-checked and deferred to the Phase 2 gate; real
network-loss timing and cross-platform behavior remain unverified.

## Cancelling setup

Use Cancel connection while SSH is connecting, verifying identity, authenticating
or opening a shell. The same action is available in identity and interactive
authentication dialogs. Cancellation keeps the tab and any displayed output,
marks it cancelled/disconnected, and offers Reconnect SSH. Pending sockets,
challenge waits and setup timers are released. Late status, output and successful
open replies cannot reactivate the cancelled attempt. Cancelling the initial
credential dialog starts no connection. Closing a live tab or established
session still follows the existing close-confirmation flow.

At the Phase 2 gate, all 113 unit tests passed on Linux/Node 24.12.0, including
real loopback SSH authentication, trust verification, keepalive and cancellation
with socket closure. Build, type, lint and format checks passed. Desktop tests
were attempted with fail-fast: one launch failure from invalid chrome-sandbox
ownership/mode, 34 not run. No sandbox permissions or settings were changed.
External OpenSSH, desktop interaction and Windows/macOS verification remain
pending. Earlier deferred-test notes describe their implementation checkpoints.
