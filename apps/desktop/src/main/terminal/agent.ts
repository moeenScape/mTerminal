import { stat } from 'node:fs/promises';
import { createAgent, utils } from '../ssh2-module.js';
import type { ParsedKey } from 'ssh2';
import type { AgentKey, AgentStatus } from '../../shared/agent.js';
import { AppFailure } from '../failures.js';
import { keyFingerprint } from './ssh.js';

const WINDOWS_OPENSSH_PIPE = '\\\\.\\pipe\\openssh-ssh-agent';
const AGENT_TIMEOUT_MS = 5000;

/**
 * Where ssh2 should find the system agent: SSH_AUTH_SOCK on Linux/macOS; on Windows the
 * OpenSSH agent pipe when SSH_AUTH_SOCK names it, otherwise Pageant.
 */
export async function findAgent(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<{ path: string; source: 'socket' | 'pageant' | 'pipe' } | undefined> {
  const socket = env.SSH_AUTH_SOCK?.trim();
  if (platform === 'win32') {
    if (socket?.startsWith('\\\\.\\pipe\\')) return { path: socket, source: 'pipe' };
    return { path: 'pageant', source: 'pageant' };
  }
  if (!socket || !socket.startsWith('/')) return undefined;
  try {
    return (await stat(socket)).isSocket() ? { path: socket, source: 'socket' } : undefined;
  } catch {
    return undefined;
  }
}

/** The agent path for a connection that needs one, or a clear failure. */
export async function requireAgent(): Promise<string> {
  const agent = await findAgent();
  if (!agent) throw new AppFailure('ssh-agent-unavailable');
  if (agent.source !== 'pageant') return agent.path;
  // Windows without SSH_AUTH_SOCK: use whichever of Pageant or the OpenSSH agent answers.
  for (const path of ['pageant', WINDOWS_OPENSSH_PIPE]) if (await listKeys(path)) return path;
  throw new AppFailure('ssh-agent-unavailable');
}

/** Lists the agent's public keys for display; never exposes private material. */
export async function agentStatus(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<AgentStatus> {
  const found = await findAgent(env, platform);
  if (!found) return { available: false, reason: 'missing' };
  const candidates =
    found.source === 'pageant'
      ? [found, { path: WINDOWS_OPENSSH_PIPE, source: 'pipe' as const }]
      : [found];
  for (const candidate of candidates) {
    const keys = await listKeys(candidate.path);
    if (keys) return { available: true, source: candidate.source, keys };
  }
  return { available: false, reason: 'unreachable' };
}

function listKeys(path: string): Promise<AgentKey[] | undefined> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: AgentKey[] | undefined) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(undefined), AGENT_TIMEOUT_MS);
    try {
      createAgent(path).getIdentities((error, keys) => {
        if (error || !keys) {
          finish(undefined);
          return;
        }
        finish(
          keys.slice(0, 50).flatMap((entry) => {
            const key = parsedKey(entry);
            return key
              ? [
                  {
                    type: key.type,
                    comment: String(key.comment ?? '').slice(0, 200),
                    fingerprint: keyFingerprint(key.getPublicSSH()),
                  },
                ]
              : [];
          }),
        );
      });
    } catch {
      finish(undefined);
    }
  });
}

/** Agents may report parsed keys, raw blobs or `{ pubKey }` entries. */
function parsedKey(entry: unknown): ParsedKey | undefined {
  if (entry && typeof entry === 'object' && 'getPublicSSH' in entry) return entry as ParsedKey;
  if (entry && typeof entry === 'object' && 'pubKey' in entry)
    return parsedKey((entry as { pubKey: unknown }).pubKey);
  if (typeof entry === 'string' || Buffer.isBuffer(entry)) {
    const parsed = utils.parseKey(entry);
    return parsed instanceof Error ? undefined : Array.isArray(parsed) ? parsed[0] : parsed;
  }
  return undefined;
}
