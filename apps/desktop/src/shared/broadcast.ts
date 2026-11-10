import { validHostId, validateHost } from './hosts.js';
import { validFingerprint } from './ssh.js';
import { validateSnippet } from './snippets.js';
import type { BatchTarget } from './batch.js';
import type { TerminalInput } from './terminal-input.js';
export const broadcastChannels = {
  targets: 'broadcast:targets',
  state: 'broadcast:state',
  start: 'broadcast:start',
  stop: 'broadcast:stop',
  send: 'broadcast:send',
} as const;
export const BROADCAST_CHANGED = 'broadcast:changed';
export interface BroadcastMode {
  id: string;
  targets: BatchTarget[];
}
export interface BroadcastState {
  mode: BroadcastMode | null;
  message: string;
}
export type BroadcastAction =
  { kind: 'line'; text: string } | { kind: 'enter' } | { kind: 'interrupt' };
export interface BroadcastApi {
  listBroadcastTargets: () => Promise<BatchTarget[]>;
  getBroadcastState: () => Promise<BroadcastState>;
  startBroadcast: (targets: BatchTarget[]) => Promise<BroadcastState>;
  stopBroadcast: () => Promise<void>;
  sendBroadcast: (id: string, action: BroadcastAction) => Promise<void>;
  onBroadcastChanged: (listener: () => void) => () => void;
}
export function validateBroadcastTargets(value: unknown): BatchTarget[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16)
    throw new Error('Select 1–16 broadcast sessions.');
  const ids = new Set<string>();
  return Array.from(value).map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Invalid broadcast target.');
    const target = value as Record<string, unknown>;
    if (
      Object.keys(target).length !== 5 ||
      Object.keys(target).some(
        (key) => !['sessionId', 'address', 'port', 'username', 'fingerprint'].includes(key),
      ) ||
      !validHostId(target.sessionId) ||
      ids.has(target.sessionId) ||
      typeof target.fingerprint !== 'string' ||
      !validFingerprint(target.fingerprint)
    )
      throw new Error('Invalid broadcast target.');
    validateHost({
      name: 'Broadcast target',
      address: target.address,
      port: target.port,
      username: target.username,
      protocol: 'ssh',
    });
    if (typeof target.username !== 'string' || !target.username)
      throw new Error('Missing broadcast account.');
    ids.add(target.sessionId);
    return {
      sessionId: target.sessionId,
      address: target.address as string,
      port: target.port as number,
      username: target.username,
      fingerprint: target.fingerprint,
    };
  });
}
export function broadcastInput(value: unknown): TerminalInput {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid broadcast input.');
  const action = value as Record<string, unknown>;
  if (action.kind === 'line' && Object.keys(action).length === 2 && Object.hasOwn(action, 'text'))
    return {
      kind: 'text',
      data:
        validateSnippet({ name: 'Broadcast', command: action.text, folder: '', tags: [] }).command +
        '\r',
    };
  if (Object.keys(action).length === 1 && action.kind === 'enter')
    return { kind: 'text', data: '\r' };
  if (Object.keys(action).length === 1 && action.kind === 'interrupt')
    return { kind: 'text', data: '\x03' };
  throw new Error('Invalid broadcast input.');
}
export function isBroadcastStopShortcut(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}) {
  return (
    event.key.toLowerCase() === 'b' &&
    event.shiftKey &&
    !event.altKey &&
    event.ctrlKey !== event.metaKey
  );
}
