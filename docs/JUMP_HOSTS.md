# Jump hosts (F50)

## Using it

Many private servers can only be reached through a public "jump" (bastion) server. In the
host editor, set **Connect through (jump host)** to another saved host. Connecting then:

1. connects to the jump host with its saved login and checks its server key;
2. opens a tunnel from the jump host to the target;
3. connects to the target through that tunnel with the target's own login.

This matches `ssh -J jump-user@jump-host user@target`. A jump host may have its own jump host,
for up to three hops (`PC → jump 1 → jump 2 → jump 3 → target`). The connection screen shows
"SSH connecting through the jump host…" while the hops connect.

## Requirements

- **Each jump host needs a saved login.** Connect to it directly once and choose *Save username
  and password*, or give it an identity with a managed private key. Jump hosts never prompt for a
  password; keyboard-interactive login is not supported on a hop. The vault must be unlocked.
- Unknown jump host server keys ask for the same trust confirmation as a direct connection, and
  a changed key refuses the connection.
- The jump host's SSH server must allow TCP forwarding (`AllowTcpForwarding`) to the target.

## Behavior and limits

- Loops, missing jump hosts and chains longer than three hops are refused when saving and again
  when connecting.
- Deleting a jump host makes the hosts that used it connect directly.
- Files (SFTP), Port forwarding and Run on hosts use the target session, so they work through the
  chain. Closing or disconnecting the tab closes every hop; if a hop drops, the session ends.
- **Install public key** in the identity editor still connects directly to the host.
- The jump setting is per host; groups do not set a default jump host yet.

## Errors

- *A jump host has no saved login*: save a login for the jump host or unlock the vault.
- *Could not connect through the jump host*: the jump host is unreachable, rejected its saved
  login, or refused to forward to the target.
- *The jump host chain is invalid*: edit the host and pick another jump host.
- A rejected server key shows the usual server identity error.

## Storage and implementation

The `jumpHostId` column (schema v10) stores the reference; workspace exports include it.
`src/main/terminal/jump.ts` resolves each hop's saved login before connecting, connects the hops
with ssh2 over the previous hop's `forwardOut` stream, and hands the final stream to the target
connection as its socket. `src/main/terminal/ipc.ts` builds the chain with `jumpChain` from
`src/shared/hosts.ts`.

## Verification

Unit tests in `tests/unit/jump-hosts.test.ts` cover chain ordering, loop/missing/length checks,
storage, deletion, backup round-trips, saved-login selection and shared authentication options.
Following the phase workflow they are written but not yet run. `npm run check` and
`npm run build` pass. Connecting through a real jump server has not been verified.
