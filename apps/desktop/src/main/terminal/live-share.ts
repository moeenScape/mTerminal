import { randomBytes, randomUUID } from 'node:crypto';
import { validAccountId, type AccountErrorCode } from '../../../../../packages/shared/accounts.ts';
import {
  LIVE_BATCH,
  LIVE_FRAME_CHARS,
  parseLiveFrame,
  validLiveInput,
  type LiveTypingGrant,
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
const inputContext = (room: string, lease: string) => `mterminal-live-input:${room}:${lease}`;
const context = (room: string) => `mterminal-live:${room}`;

interface Host {
  room: string;
  terminalId: string;
  key: Buffer;
  request: RelayRequest;
  filter: LogTextStream;
  pending: string;
  sequence: number;
  email: string;
  guestReady: boolean;
  controlRevision: number;
  control: {
    lease: string;
    writer: NonNullable<ReturnType<TerminalRegistry['acquireGuestWriter']>>;
    latest: number;
    granted: boolean;
  } | null;
  timer?: ReturnType<typeof setTimeout>;
}

export class TerminalLiveShare {
  private host: Host | undefined;
  private disposed = false;
  private state: LiveState = { active: false };
  private readonly cleanup: (() => void)[];

  constructor(
    private readonly terminals: Pick<
      TerminalRegistry,
      'isReady' | 'onOutput' | 'onSessionClosed' | 'acquireGuestWriter'
    >,
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

  get guestEmail(): string | undefined {
    return this.host?.guestReady && !this.host.control ? this.host.email : undefined;
  }

  private notifyHost(host: Host): void {
    const typing = host.control ? (host.control.granted ? 'guest' : 'granting') : 'host';
    if (
      this.state.active &&
      this.state.typing === typing &&
      this.state.guestReady === host.guestReady
    )
      return;
    this.state = { active: true, typing, guestReady: host.guestReady };
    this.changed(this.state);
  }

  async grant(): Promise<void> {
    const host = this.host;
    if (!host || !host.guestReady || host.control) throw new WorkspaceSyncFailure('live-control');
    const writer = this.terminals.acquireGuestWriter(host.terminalId);
    if (!writer) throw new WorkspaceSyncFailure('live-control');
    const revision = ++host.controlRevision;
    const lease = randomUUID();
    const control = { lease, writer, latest: 0, granted: false };
    host.control = control;
    this.notifyHost(host);
    try {
      const result = await host.request({ kind: 'control', room: host.room, revision, lease });
      if (this.host !== host || host.controlRevision !== revision) return;
      if (result.revision !== revision || result.lease !== lease || host.control !== control)
        throw new WorkspaceSyncFailure('live-control');
      control.granted = true;
      this.notifyHost(host);
    } catch {
      if (this.host !== host || host.controlRevision !== revision) return;
      this.stop('live-control');
      throw new WorkspaceSyncFailure('live-control');
    }
  }

  reclaim(): void {
    const host = this.host;
    if (!host?.control) return;
    const revision = ++host.controlRevision;
    host.control.writer.release();
    host.control = null;
    host.guestReady = false;
    this.notifyHost(host);
    void host
      .request({ kind: 'control', room: host.room, revision, lease: null })
      .then((result) => {
        if (result.revision !== revision || result.lease !== null)
          throw new WorkspaceSyncFailure('live-control');
      })
      .catch(() => {
        if (this.host === host && host.controlRevision === revision) this.stop('live-control');
      });
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
      email: target.email,
      guestReady: false,
      controlRevision: 0,
      control: null,
    };
    this.host = host;
    this.notifyHost(host);
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
      this.applyControl(host, response);
      host.timer = setTimeout(() => void this.flush(host), INTERVAL);
    } catch {
      if (this.host === host) this.stop('live-unavailable');
    }
  }

  private applyControl(host: Host, response: Record<string, unknown>): void {
    const { revision, lease, input, guestReady } = response;
    // A heartbeat begun before a handoff cannot deliver input from that handoff later.
    if (
      typeof revision !== 'number' ||
      !Number.isSafeInteger(revision) ||
      revision < 0 ||
      revision > host.controlRevision ||
      typeof guestReady !== 'boolean'
    )
      throw new WorkspaceSyncFailure('sync-format');
    if (revision < host.controlRevision) return;
    host.guestReady = guestReady;
    const control = host.control;
    if (control && lease === null) {
      control.writer.release();
      host.control = null;
    } else if (control && lease === control.lease && input !== null) {
      if (!input || typeof input !== 'object') throw new WorkspaceSyncFailure('sync-format');
      const { sequence, frame: raw } = input as Record<string, unknown>;
      const frame = parseLiveFrame(raw);
      if (!frame || frame.ciphertext.length > 8192 || sequence !== control.latest + 1)
        throw new WorkspaceSyncFailure('live-control');
      const line = openSyncPayload(
        frame,
        host.key,
        inputContext(host.room, control.lease),
        sequence,
      );
      if (!validLiveInput(line)) throw new WorkspaceSyncFailure('sync-format');
      control.writer.write({ kind: 'text', data: line + '\r' });
      control.latest = sequence;
    } else if (lease !== (control?.lease ?? null)) {
      throw new WorkspaceSyncFailure('live-control');
    }
    this.notifyHost(host);
  }

  stop(reason?: AccountErrorCode): void {
    const host = this.host;
    if (!host) return;
    this.host = undefined;
    clearTimeout(host.timer);
    host.pending = '';
    host.control?.writer.release();
    host.control = null;
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

function decodeInvitation(invitation: string): { room: string; key: Buffer } {
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
  if (key.length !== 32 || key.toString('base64url') !== encoded) {
    key.fill(0);
    throw new WorkspaceSyncFailure('live-unavailable');
  }
  return { room, key };
}

export async function sendLiveInput(
  invitation: string,
  lease: string,
  sequence: number,
  text: string,
  request: RelayRequest,
): Promise<void> {
  const { room, key } = decodeInvitation(invitation);
  try {
    const frame = sealSyncPayload(text, key, inputContext(room, lease), sequence, 1);
    await request({ kind: 'input', room, lease, sequence, frame });
  } finally {
    key.fill(0);
  }
}

export async function yieldLiveInput(
  invitation: string,
  lease: string,
  request: RelayRequest,
): Promise<void> {
  const { room, key } = decodeInvitation(invitation);
  key.fill(0);
  await request({ kind: 'yield', room, lease });
}

function readTyping(value: unknown): LiveTypingGrant | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object') throw new WorkspaceSyncFailure('sync-format');
  const { lease, next, ready } = value as Record<string, unknown>;
  if (
    !validAccountId(lease) ||
    typeof next !== 'number' ||
    !Number.isSafeInteger(next) ||
    next < 1 ||
    typeof ready !== 'boolean'
  )
    throw new WorkspaceSyncFailure('sync-format');
  return { lease, next, ready };
}

export async function viewLiveShare(
  invitation: string,
  after: number,
  request: RelayRequest,
): Promise<LiveView> {
  const { room, key } = decodeInvitation(invitation);
  try {
    const { frames, typing } = await request({ kind: 'view', room, after });
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
    return { output, cursor, typing: readTyping(typing) };
  } finally {
    key.fill(0);
  }
}
