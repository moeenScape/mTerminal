import { createRequire } from 'node:module';
import type * as Ssh2 from 'ssh2';

const require = createRequire(import.meta.url);
const ssh2 = require('ssh2') as typeof Ssh2;

export const { Client, utils, createAgent } = ssh2;
export type { ClientChannel, SFTPWrapper, Stats } from 'ssh2';

// SSH disconnect reason SSH_DISCONNECT_KEY_EXCHANGE_FAILED (RFC 4253).
const KEY_EXCHANGE_FAILED = 3;

export function isSshKeyExchangeFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if ('code' in error && error.code === KEY_EXCHANGE_FAILED) return true;
  return (
    'level' in error &&
    error.level === 'handshake' &&
    error.message.startsWith('Handshake failed: no matching ')
  );
}
