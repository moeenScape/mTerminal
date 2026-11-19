# Proxies (F51)

## Using it

Some networks (offices, universities, hotels) block direct SSH and only allow traffic through a
proxy server.

1. Open **Settings → Proxies → Add proxy**. Enter a name, the type, address and port, and an
   optional username and password.
2. Edit a host and choose the proxy under **Connect through proxy**.
3. Connect as usual. The connection screen shows "SSH connecting through the proxy…".

| Type | Notes |
| --- | --- |
| SOCKS5 | No authentication, or username/password (RFC 1929). Host names are resolved by the proxy. IPv4 and IPv6 targets are supported. |
| SOCKS4 / 4a | Optional user ID, no password. Host names use SOCKS4a; IPv6 targets are not supported. |
| HTTP CONNECT | Optional Basic authentication. The SSH traffic inside the tunnel stays encrypted, but the proxy login is only Base64-encoded, so use it on trusted networks. |

## Behavior and limits

- The proxy carries only the first network connection. Without a jump host that is the
  target. With jump hosts it is the connection to the first jump host, using that jump host's
  proxy if it has one, otherwise the target's proxy. Later hops travel inside SSH.
- Proxy passwords are stored in the encrypted vault and need an unlocked vault to save or use.
  Proxy records themselves contain no secrets.
- Deleting a proxy makes the hosts that used it connect directly.
- At most 50 saved proxies. The proxy handshake must finish within 20 seconds and can be
  cancelled from the connection screen.
- Files (SFTP), Port forwarding and Run on hosts use the session, so they work through the proxy.
  **Install public key** still connects directly.
- Proxies are not included in workspace exports; groups do not set a default proxy yet. NTLM,
  Kerberos and PAC/automatic proxy detection are not supported.

## Errors

- *Could not connect through the proxy*: the proxy is unreachable, timed out or answered with
  something unexpected.
- *The proxy rejected its login*: wrong username/password (HTTP 407 or SOCKS authentication
  failure), or the vault is locked so the saved password could not be read.
- *The proxy refused to connect to the server*: the proxy blocks that address or port.

## Storage and implementation

Proxies are stored in SQLite (schema v11, `proxies`, plus `hosts.proxyId`).
`src/main/terminal/proxy.ts` opens the TCP connection and performs the SOCKS5, SOCKS4/4a or HTTP
CONNECT handshake, then hands the socket to ssh2 as its `sock` (directly, or to the first jump
host). `src/main/proxies-ipc.ts` manages proxy records and their vault passwords; the renderer
learns only whether a password is saved.

## Verification

Unit tests in `tests/unit/proxies.test.ts` cover validation, IPv6 expansion, SOCKS5 with
authentication, SOCKS4a, HTTP CONNECT with early data, login and refusal errors, unreachable
proxies, cancellation and storage. Following the phase workflow they are written but not yet
run. `npm run check` and `npm run build` pass. Connecting through a real proxy has not been
verified.
