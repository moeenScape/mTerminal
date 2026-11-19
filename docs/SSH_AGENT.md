# SSH agents (F52)

## Using it

An SSH agent keeps your unlocked private keys in memory so programs can sign in without reading
the key files. mTerminal can use the system agent instead of a saved password or key.

1. Load a key into your agent, for example `ssh-add ~/.ssh/id_ed25519`.
2. Edit a host and set **Sign in with** to **SSH agent**. The hint below shows whether an agent
   was found and which keys it holds.
3. Connect. No password is asked or saved.

You can also choose **SSH agent** as the authentication method in the connect dialog for one
connection.

### Agent forwarding

**Forward my SSH agent to this server** (like `ssh -A`) lets commands on the server use your
PC's agent, for example `git pull` from a private repository or `ssh` to another server, without
copying keys there. It works with any sign-in method.

Anyone with root access on that server can use your agent's keys while you are connected, so
forward only to servers you trust. The host editor shows this warning when forwarding is on.

## Where the agent is found

| Platform | Agent |
| --- | --- |
| Linux / macOS | The socket in `SSH_AUTH_SOCK` (ssh-agent, GNOME Keyring, gpg-agent, 1Password, …). |
| Windows | The pipe in `SSH_AUTH_SOCK` if set; otherwise Pageant, then the OpenSSH Authentication Agent service (`\\.\pipe\openssh-ssh-agent`). |

mTerminal reads `SSH_AUTH_SOCK` from the environment it was started with. If you start an agent
later in a terminal, restart mTerminal from that session, or use your desktop's agent.

## Behavior and limits

- Agent sign-in needs a username (from the host, its group or its identity). The vault is not
  needed because the agent holds the keys.
- Jump hosts set to **SSH agent** sign in with the agent too. Forwarding applies to the target
  server only, not to jump hosts.
- If agent sign-in or forwarding is set and no agent is found, the connection stops with *No SSH
  agent was found* instead of continuing silently.
- The key list shows at most 50 keys with type, comment and SHA256 fingerprint. Private key
  material never leaves the agent.
- Agent-based identities and per-group agent defaults are not available yet.

## Storage and implementation

`hosts.useAgent` and `hosts.agentForwarding` (schema v12) store the preferences.
`src/main/terminal/agent.ts` finds the agent, lists its public keys and supplies the path to
ssh2 (`agent`, `authHandler: ['agent']`, and `agentForward` for forwarding). The renderer gets
only the status and public key summaries.

## Verification

Unit tests in `tests/unit/ssh-agent.test.ts` cover agent discovery on Linux and Windows, key
listing through a stand-in agent, authentication options, host storage and jump-hop sign-in.
Following the phase workflow they are written but not yet run. `npm run check` and
`npm run build` pass. Sign-in and forwarding against a real server have not been verified.
