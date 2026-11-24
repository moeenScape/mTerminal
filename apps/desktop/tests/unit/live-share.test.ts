import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { TerminalLiveShare, viewLiveShare } from '../../src/main/terminal/live-share.js';
import type { LiveRelayAction } from '../../../../packages/shared/live-share.ts';

it('relays only selected terminal output and authenticates its ciphertext and sequence', async () => {
  vi.useFakeTimers();
  const room = randomUUID();
  const terminalId = randomUUID();
  let output!: (id: string, data: string) => void;
  let closed!: (id: string) => void;
  const terminal = {
    isReady: (id: string) => id === terminalId,
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
      return { sequence: action.sequence };
    }
    if (action.kind === 'view') return { frames: [{ sequence: 1, frame }] };
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
