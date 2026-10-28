import type { LocalDatabase } from '../storage/database.js';
import { knownHostAddress } from '../storage/database.js';
import type { SshQuestion } from '../../shared/ssh.js';
import { keyFingerprint } from './ssh.js';

export async function verifyKnownHost(
  database: LocalDatabase,
  address: string,
  port: number,
  key: Buffer,
  pin: string,
  signal: AbortSignal,
  ask: (question: SshQuestion) => Promise<string[]>,
): Promise<boolean> {
  if (signal.aborted) return false;
  const endpoint = knownHostAddress(address, port);
  const fingerprint = keyFingerprint(key);
  if (pin && pin !== fingerprint) return false;
  const previous = database.getKnownHost(endpoint, port);
  if (previous === fingerprint) return true;
  const answers = await ask({
    title: 'Server identity',
    instructions: '',
    prompts: [{ prompt: 'Trust decision', echo: true }],
    trust: { address: endpoint, port, fingerprint, ...(previous ? { previous } : {}) },
  });
  if (signal.aborted) return false;
  if (previous) {
    if (answers[0] === fingerprint) database.trustKnownHost(endpoint, port, fingerprint, previous);
    // A changed key always ends this attempt, even after explicitly approving replacement.
    return false;
  }
  if (answers[0] !== 'trust') return false;
  database.trustKnownHost(endpoint, port, fingerprint);
  return true;
}
