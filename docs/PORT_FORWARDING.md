# Port forwarding (F49)

## Using it

Connect a saved host, open the SSH tab's **⋯** menu and choose **Port forwarding…**. The panel
lists the host's saved rules with a Start/Stop button, a status and the number of open
connections. **New forward** creates a rule; **Edit** and **Delete** change saved rules. Rules
can be edited while the tab is disconnected, but forwards only run on a connected session.

| Type | Listens on | Connections go to | Example |
| --- | --- | --- | --- |
| Local (`ssh -L`) | This PC | Destination as seen from the server | `127.0.0.1:8080` → `127.0.0.1:5432` opens the server's database on your `localhost:8080` |
| Remote (`ssh -R`) | The server | Destination as seen from this PC | Server `127.0.0.1:9000` → `127.0.0.1:3000` exposes your local dev server to the server |
| Dynamic (`ssh -D`) | This PC | Any host the SOCKS client asks for, opened from the server | `127.0.0.1:1080`; set it as a SOCKS5 proxy in a browser |

Remote forwards accept port `0`; the server chooses a port and the panel shows it.

## Behavior and limits

- Forwards run through the tab's existing SSH connection; no extra login is needed. Closing,
  disconnecting or reconnecting the tab stops its forwards. Start them again after reconnecting.
- The listen address defaults to `127.0.0.1`, so only this PC can connect. Any other address
  shows a warning: local and dynamic forwards then accept connections from your network, and
  remote forwards may be reachable by other machines if the server's `GatewayPorts` allows it.
- Editing a rule stops its running forward; deleting a rule stops and removes it.
- At most 20 saved rules per host, 32 running forwards per window and 64 simultaneous
  connections per forward. Extra connections are refused and counted as failed.
- The dynamic forward implements SOCKS5 CONNECT without authentication (IPv4, IPv6 and domain
  names; domain names are resolved by the server). SOCKS4, BIND and UDP ASSOCIATE are not
  supported. Handshakes must finish within 10 seconds.
- Errors are shown per rule: port already in use, permission denied (ports below 1024 usually
  need administrator rights), unavailable listen address, the server refusing the request
  (`AllowTcpForwarding`, `GatewayPorts`, or the port is busy there) and disconnection. A
  destination that refuses a single connection closes only that connection.

## Storage

Rules are stored in SQLite (schema v9, `port_forwards`) and are deleted with their host. They
contain no credentials and are not yet part of workspace exports. Running forwards are never
persisted or restarted automatically.

## Implementation

`src/main/terminal/port-forward.ts` opens the listeners with `node:net` and the SSH channels
with ssh2 (`forwardOut`, `forwardIn`/`unforwardIn`, `tcp connection`).
`src/main/terminal/forwards-ipc.ts` owns running forwards per window, stops them when their
session closes, the renderer reloads or the window closes, and validates every IPC request.
The renderer only receives rule data and counters.

## Verification

Unit tests in `tests/unit/port-forwarding.test.ts` cover rule validation, SOCKS5 parsing,
local and SOCKS tunnelling through a stand-in SSH client, busy-port reporting, storage limits
and cascade deletion, and session-close cleanup. Following the phase workflow, they are
written but not yet run. `npm run check` and `npm run build` pass. Live forwarding against a
real SSH server has not been verified.
