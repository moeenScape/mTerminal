import { randomBytes } from 'node:crypto';
import { validAccountId, type AccountErrorCode } from '../../../../../packages/shared/accounts.ts';
import {
  LIVE_BATCH,
  LIVE_FRAME_CHARS,
  parseLiveFrame,
  type LiveRelayAction,
} from '../../../../../packages/shared/live-share.ts';
import type { LiveState, LiveView } from '../../shared/live-share.js';
import { WorkspaceSyncFailure } from '../../shared/workspace-sync.js';
import { openSyncPayload, sealSyncPayload } from '../storage/workspace-sync.js';
import { LogTextStream } from './session-logs.js';
import type { TerminalRegistry } from './registry.js';

const PREFIX = 'mterminal-live-v1';
const INTERVAL = 750;
type RelayRequest = (action: LiveRelayAction) => Promise<Record<string, unknown>>;
const context = (room: string) => `mterminal-live:${room}`;

interface Host {
  room: string;
  terminalId: string;
  key: Buffer;
  request: RelayRequest;
  filter: LogTextStream;
  pending: string;
  sequence: number;
  timer?: ReturnType<typeof setTimeout>;
}

export class TerminalLiveShare {
  private host: Host | undefined;
  private disposed = false;
  private state: LiveState = { active: false };
  private readonly cleanup: (() => void)[];

  constructor(
    private readonly terminals: Pick<TerminalRegistry, 'isReady' | 'onOutput' | 'onSessionClosed'>,
    private readonly changed: (state: LiveState) => void,
  ) {
    this.cleanup = [
      terminals.onOutput((id, data) => {
        const host = this.host;
        if (!host || id !== host.terminalId) return;
        // Bound work before filtering and stop rather than silently dropping output.
        if (data.length > LIVE_FRAME_CHARS * 4) return this.stop('live-output');
        host.pending += host.filter.feed(data);
        if (host.pending.length > LIVE_FRAME_CHARS * 4) this.stop('live-output');
      }),
      terminals.onSessionClosed((id) => {
        if (id === this.host?.terminalId) this.stop();
      }),
    ];
  }

  get status(): LiveState {
    return this.state;
  }

  async start(
    terminalId: string,
    target: Extract<LiveRelayAction, { kind: 'start' }>,
    request: RelayRequest,
  ): Promise<LiveView> {
    if (this.disposed || this.host || !this.terminals.isReady(terminalId))
      throw new WorkspaceSyncFailure('live-unavailable');
    const { room } = await request(target);
    if (!validAccountId(room)) throw new WorkspaceSyncFailure('sync-format');
    if (this.disposed || !this.terminals.isReady(terminalId)) {
      await request({ kind: 'stop', room }).catch(() => {});
      throw new WorkspaceSyncFailure('live-unavailable');
    }
    const host: Host = {
      room,
      terminalId,
      key: randomBytes(32),
      request,
      filter: new LogTextStream(),
      pending: '',
      sequence: 0,
    };
    this.host = host;
    this.state = { active: true };
    this.changed(this.state);
    host.timer = setTimeout(() => void this.flush(host), INTERVAL);
    return { state: this.state, invitation: `${PREFIX}.${room}.${host.key.toString('base64url')}` };
  }

  private async flush(host: Host): Promise<void> {
    if (this.host !== host) return;
    if (!this.terminals.isReady(host.terminalId)) return this.stop();
    const limit = LIVE_FRAME_CHARS;
    let length = Math.min(limit, host.pending.length);
    if (length && /[\uD800-\uDBFF]/u.test(host.pending[length - 1]!)) length--;
    const text = host.pending.slice(0, length);
    host.pending = host.pending.slice(length);
    try {
      const sequence = host.sequence + 1;
      const packet = text
        ? { sequence, frame: sealSyncPayload(text, host.key, context(host.room), sequence, 1) }
        : {};
      const response = await host.request({ kind: 'push', room: host.room, ...packet });
      if (this.host !== host) return;
      if (response.sequence !== (text ? sequence : host.sequence))
        throw new WorkspaceSyncFailure('live-gap');
      if (text) host.sequence = sequence;
      host.timer = setTimeout(() => void this.flush(host), INTERVAL);
    } catch {
      if (this.host === host) this.stop('live-unavailable');
    }
  }

  stop(reason?: AccountErrorCode): void {
    const host = this.host;
    if (!host) return;
    this.host = undefined;
    clearTimeout(host.timer);
    host.pending = '';
    host.key.fill(0);
    this.state = { active: false, ...(reason ? { reason } : {}) };
    this.changed(this.state);
    void Promise.resolve()
      .then(() => host.request({ kind: 'stop', room: host.room }))
      .catch(() => {});
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    for (const off of this.cleanup) off();
  }
}

export async function viewLiveShare(
  invitation: string,
  after: number,
  request: RelayRequest,
): Promise<LiveView> {
  const [prefix, room, encoded, ...extra] = invitation.split('.');
  if (
    prefix !== PREFIX ||
    !validAccountId(room) ||
    !encoded ||
    !/^[a-z0-9_-]{43}$/i.test(encoded) ||
    extra.length
  )
    throw new WorkspaceSyncFailure('live-unavailable');
  const key = Buffer.from(encoded, 'base64url');
  try {
    if (key.length !== 32 || key.toString('base64url') !== encoded)
      throw new WorkspaceSyncFailure('live-unavailable');
    const { frames } = await request({ kind: 'view', room, after });
    if (!Array.isArray(frames) || frames.length > LIVE_BATCH)
      throw new WorkspaceSyncFailure('sync-format');
    let cursor = after;
    let output = '';
    for (const [index, value] of frames.entries()) {
      if (
        !value ||
        typeof value !== 'object' ||
        !Number.isSafeInteger(value.sequence) ||
        value.sequence <= cursor ||
        ((index > 0 || after > 0) && value.sequence !== cursor + 1)
      )
        throw new WorkspaceSyncFailure('live-gap');
      const frame = parseLiveFrame(value.frame);
      if (!frame) throw new WorkspaceSyncFailure('sync-format');
      const text = openSyncPayload(frame, key, context(room), value.sequence);
      if (typeof text !== 'string' || text.length > LIVE_FRAME_CHARS)
        throw new WorkspaceSyncFailure('sync-format');
      output += text;
      cursor = value.sequence;
    }
    return { output, cursor };
  } finally {
    key.fill(0);
  }
}
