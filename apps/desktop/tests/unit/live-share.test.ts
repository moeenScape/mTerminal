import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import {
  TerminalLiveShare,
  sendLiveInput,
  viewLiveShare,
} from '../../src/main/terminal/live-share.js';
import type { LiveRelayAction } from '../../../../packages/shared/live-share.ts';

it('relays only selected terminal output and authenticates its ciphertext and sequence', async () => {
  vi.useFakeTimers();
  const room = randomUUID();
  const terminalId = randomUUID();
  let output!: (id: string, data: string) => void;
  let closed!: (id: string) => void;
  const terminal = {
    isReady: (id: string) => id === terminalId,
    acquireGuestWriter: vi.fn(),
    onOutput: (callback: typeof output) => {
      output = callback;
      return vi.fn();
    },
    onSessionClosed: (callback: typeof closed) => {
      closed = callback;
      return vi.fn();
    },
  };
  const states = vi.fn();
  const host = new TerminalLiveShare(terminal, states);
  let frame: Extract<LiveRelayAction, { kind: 'push' }>['frame'];
  const relay = vi.fn(async (action: LiveRelayAction) => {
    if (action.kind === 'start') return { room };
    if (action.kind === 'push') {
      frame = action.frame;
      return {
        sequence: action.sequence,
        guestReady: false,
        revision: 0,
        lease: null,
        input: null,
      };
    }
    if (action.kind === 'view') return { typing: null, frames: [{ sequence: 1, frame }] };
    return {};
  });
  try {
    const { invitation } = await host.start(
      terminalId,
      {
        kind: 'start',
        organizationId: randomUUID(),
        vaultId: randomUUID(),
        email: 'guest@example.com',
      },
      relay,
    );
    expect(invitation).toBeTruthy();
    output(randomUUID(), 'unshared');
    output(terminalId, '\x1b]52;secret\x07visible\r\n');
    await vi.advanceTimersByTimeAsync(750);
    expect(JSON.stringify(relay.mock.calls)).not.toMatch(
      /unshared|visible|secret|mterminal-live-v1/,
    );
    await expect(viewLiveShare(invitation!, 0, relay)).resolves.toEqual({
      output: 'visible\n',
      cursor: 1,
      typing: null,
    });
    await expect(
      viewLiveShare(invitation!, 1, async () => ({
        frames: [{ sequence: 2, frame }],
      })),
    ).rejects.toThrow('sync-key');
    closed(terminalId);
    expect(host.status).toEqual({ active: false });
    await vi.advanceTimersByTimeAsync(750);
    expect(relay).toHaveBeenCalledWith({ kind: 'stop', room });
  } finally {
    host.dispose();
    vi.useRealTimers();
  }
});

it('encrypts guest input and discards an in-flight delivery after the host takes control back', async () => {
  vi.useFakeTimers();
  const terminalId = randomUUID();
  const room = randomUUID();
  const writer = { write: vi.fn(), release: vi.fn() };
  const host = new TerminalLiveShare(
    {
      isReady: () => true,
      acquireGuestWriter: () => writer,
      onOutput: () => vi.fn(),
      onSessionClosed: () => vi.fn(),
    },
    vi.fn(),
  );
  let revision = 0;
  let lease: string | null = null;
  let pending: Record<string, unknown> | null = null;
  let hold = false;
  let finishDeferred: (() => void) | undefined;
  const relay = async (action: LiveRelayAction): Promise<Record<string, unknown>> => {
    if (action.kind === 'start') return { room };
    if (action.kind === 'control') {
      revision = action.revision;
      lease = action.lease;
      return { revision, lease };
    }
    if (action.kind === 'input') {
      expect(JSON.stringify(action)).not.toContain('echo example');
      pending = { sequence: action.sequence, frame: action.frame };
      return {};
    }
    if (action.kind === 'push') {
      const response = { sequence: 0, guestReady: true, revision, lease, input: pending };
      pending = null;
      if (hold)
        return new Promise((resolve) => {
          finishDeferred = () => resolve(response);
        });
      return response;
    }
    return {};
  };
  try {
    const target = {
      kind: 'start',
      organizationId: randomUUID(),
      vaultId: randomUUID(),
      email: 'guest@example.com',
    } as const;
    const { invitation } = await host.start(terminalId, target, relay);
    await vi.advanceTimersByTimeAsync(750);
    expect(host.guestEmail).toBe(target.email);
    await host.grant();
    expect(host.status.typing).toBe('guest');
    await sendLiveInput(invitation!, lease!, 1, 'echo example', relay);
    await vi.advanceTimersByTimeAsync(750);
    expect(writer.write).toHaveBeenCalledExactlyOnceWith({ kind: 'text', data: 'echo example\r' });
    hold = true;
    await sendLiveInput(invitation!, lease!, 2, 'echo example', relay);
    await vi.advanceTimersByTimeAsync(750);
    expect(finishDeferred).toBeDefined();
    host.reclaim();
    expect(writer.release).toHaveBeenCalledOnce();
    expect(host.status.typing).toBe('host');
    finishDeferred?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(writer.write).toHaveBeenCalledOnce();
  } finally {
    host.dispose();
    vi.useRealTimers();
  }
});
