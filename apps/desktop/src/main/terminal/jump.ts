import type { Duplex } from 'node:stream';
import type { Client as SshClient, ClientChannel } from 'ssh2';
import { Client } from '../ssh2-module.js';
import { resolveHost, type HostDraft, type SavedHost } from '../../shared/hosts.js';
import type { SshCredentials } from '../../shared/ssh.js';
import { AppFailure } from '../failures.js';
import type { LocalDatabase } from '../storage/database.js';
import { knownHostAddress } from '../storage/database.js';
import type { SshSecretStore } from '../storage/secret-store.js';
import { sshAuthConfig, type SshVia } from './ssh.js';
import { requireAgent } from './agent.js';

export interface JumpHop {
  name: string;
  address: string;
  port: number;
  credentials: SshCredentials;
  /** System agent path when this hop signs in with the agent. */
  agent?: string;
}

/**
 * Saved login for a jump host, chosen like a one-click connection: the host's own saved
 * login, then its identity's managed key, then a password saved for the host or identity.
 * Jump hosts never prompt for a password.
 */
export async function savedJumpCredentials(
  host: SavedHost,
  database: LocalDatabase,
  secrets: SshSecretStore,
): Promise<SshCredentials> {
  try {
    const resolved = resolveHost(host, database.listHostGroups());
    const identity = database.listSshIdentities().find((item) => item.id === resolved.identityId);
    const own = await secrets.getLogin(host.id);
    const base = { fingerprint: '', keyboardInteractive: false };
    const agentUser = identity?.username || resolved.username;
    if (host.useAgent && agentUser) return { ...base, username: agentUser, method: 'agent' };
    if (own?.username)
      return { ...base, username: own.username, method: 'password', password: own.password };
    const username = identity?.username || resolved.username;
    if (username && identity?.method === 'privateKey') {
      const key = await secrets.getPrivateKey(identity.id);
      if (key) return { ...base, username, method: 'privateKey', ...key };
    }
    if (username && own) return { ...base, username, method: 'password', password: own.password };
    if (username && identity?.method === 'password') {
      const shared = await secrets.getLogin(identity.id);
      if (shared)
        return {
          ...base,
          username: shared.username ?? username,
          method: 'password',
          password: shared.password,
        };
    }
  } catch {
    // A locked or unavailable vault is reported as a missing jump login.
  }
  throw new AppFailure('ssh-jump-login-missing');
}

/** Resolves connection details and saved logins for every hop, before anything connects. */
export async function prepareJumpHops(
  chain: SavedHost[],
  database: LocalDatabase,
  secrets: SshSecretStore,
): Promise<JumpHop[]> {
  const groups = database.listHostGroups();
  const hops: JumpHop[] = [];
  for (const host of chain) {
    const resolved: HostDraft = resolveHost(host, groups);
    hops.push({
      name: host.name,
      address: knownHostAddress(resolved.address, resolved.port),
      port: resolved.port,
      credentials: await savedJumpCredentials(host, database, secrets),
      ...(host.useAgent ? { agent: await requireAgent() } : {}),
    });
  }
  return hops;
}

/**
 * Connects through each hop in turn and returns a TCP tunnel from the last hop to the target.
 * Closing the returned tunnel closes every hop. Any failure closes the hops opened so far.
 */
export function openJumpChain(
  hops: JumpHop[],
  target: { address: string; port: number },
  signal: AbortSignal,
  verifyKey: (hop: JumpHop, key: Buffer) => Promise<boolean>,
  /** Already-open connection to the first hop, e.g. through a proxy. */
  firstSock?: Duplex,
): Promise<SshVia> {
  return new Promise((resolve, reject) => {
    const clients: SshClient[] = [];
    let settled = false;
    let closed = false;
    let tunnel: ClientChannel | undefined;
    let mismatch = false;
    const closeAll = () => {
      if (closed) return;
      closed = true;
      signal.removeEventListener('abort', aborted);
      tunnel?.destroy();
      for (const client of clients.reverse()) client.destroy();
      firstSock?.destroy();
    };
    const fail = (code: 'ssh-jump-failed' | 'ssh-cancelled' | 'ssh-key-mismatch') => {
      closeAll();
      if (settled) return;
      settled = true;
      reject(new AppFailure(code));
    };
    const aborted = () => fail('ssh-cancelled');
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) {
      aborted();
      return;
    }
    const connectHop = (index: number, sock?: Duplex) => {
      const hop = hops[index]!;
      const next = hops[index + 1] ?? target;
      const client = new Client();
      clients.push(client);
      const lost = () => {
        if (!settled)
          fail(
            signal.aborted ? 'ssh-cancelled' : mismatch ? 'ssh-key-mismatch' : 'ssh-jump-failed',
          );
        // After the tunnel is handed over, losing any hop ends the session through it.
        else closeAll();
      };
      client.on('error', lost).on('close', lost);
      client.once('ready', () => {
        if (closed) return;
        client.forwardOut('127.0.0.1', 0, next.address, next.port, (error, channel) => {
          if (closed) {
            channel?.destroy();
            return;
          }
          if (error) {
            fail('ssh-jump-failed');
            return;
          }
          if (index + 1 < hops.length) {
            connectHop(index + 1, channel);
            return;
          }
          tunnel = channel;
          channel.once('close', closeAll);
          settled = true;
          resolve({ sock: channel, close: closeAll });
        });
      });
      try {
        client.connect({
          host: hop.address,
          port: hop.port,
          ...(sock ? { sock } : {}),
          keepaliveInterval: 15000,
          keepaliveCountMax: 3,
          readyTimeout: 120000,
          ...sshAuthConfig(hop.credentials, hop.agent),
          hostVerifier: (key: Buffer, verify: (accepted: boolean) => void) => {
            void verifyKey(hop, key)
              .then((accepted) => {
                mismatch = !accepted;
                if (!closed) verify(accepted);
              })
              .catch(() => {
                mismatch = true;
                if (!closed) verify(false);
              });
          },
        });
      } catch {
        fail('ssh-jump-failed');
      }
    };
    connectHop(0, firstSock);
  });
}
