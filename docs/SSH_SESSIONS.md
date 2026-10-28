# SSH terminal sessions

Create a saved SSH profile in Hosts. Group defaults supply port and username only
when the corresponding inheritance flags are enabled. Choose **Connect** to open
a terminal tab, then provide the SSH username, password and server fingerprint.
The app supports password authentication in this initial step. Private keys,
passphrases, agents and keyboard-interactive authentication are not yet available.

Obtain the SHA256 host-key fingerprint from the server administrator through a
trusted channel. On the server, an administrator can inspect a public host key:

```sh
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub -E sha256
```

Enter only the `SHA256:...` portion, for the host key actually offered by the
server. Other key types have their own public-key files. Do not copy an unverified
fingerprint from the network into this field: the supplied value is the trust
anchor. A mismatched key refuses the connection before password authentication.
The app does not yet maintain known-host records or provide trust-on-first-use.

Passwords are held in memory for the connection attempt/session and are not
stored in SQLite, preferences, diagnostics, or tab records. JavaScript strings
cannot be reliably zeroed; this is not a memory-erasure guarantee. Fingerprints
are requested again for each connection. Host edits affect new connections.

The remote terminal supports text/binary input, resizing, search, clipboard and
appearance controls through the same workspace as local terminals. Closing a tab
closes its SSH channel and connection; it cannot guarantee that detached remote
processes stop. Output remains capped by the existing scrollback and pending-data
limits. Shell exit retains displayed output. Reconnect is explicit and never
replays commands. Network failures currently end with a nonzero shell status.

Handshake timeout is 15 seconds; overall connection/channel setup is limited to
20 seconds. Wrong credentials and network/setup failures produce fixed error
messages. Check server reachability and authentication policy before retrying.

Implementation reference: [ssh2 client and channel API](https://github.com/mscdex/ssh2#api).
Loopback server tests and desktop prompt tests are written but deferred until the
Phase 2 gate. Live OpenSSH, interactive program and Windows/macOS checks remain
pending. The existing Electron sandbox issue blocks desktop validation here.
