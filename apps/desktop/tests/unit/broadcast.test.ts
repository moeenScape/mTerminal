import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { InputBroadcast } from '../../src/main/terminal/broadcast.js';
import {
  broadcastInput,
  isBroadcastStopShortcut,
  validateBroadcastTargets,
} from '../../src/shared/broadcast.js';
import type { BatchTarget } from '../../src/shared/batch.js';
function fixture() {
  let targets: BatchTarget[] = [0, 1, 2].map((n) => ({
    sessionId: randomUUID(),
    address: `host-${n}.internal`,
    port: 22,
    username: 'deploy',
    fingerprint: `SHA256:${'a'.repeat(43)}`,
  }));
  let closed: (id: string) => void = () => undefined;
  const unsubscribe = vi.fn();
  const write = vi.fn();
  const changed = vi.fn();
  const broadcast = new InputBroadcast(
    {
      executionTargets: () => targets,
      write,
      onSessionClosed: (listener) => {
        closed = listener;
        return unsubscribe;
      },
    },
    changed,
  );
  return {
    broadcast,
    write,
    changed,
    unsubscribe,
    targets: () => targets,
    change: (next: BatchTarget[]) => {
      targets = next;
    },
    close: (id: string) => closed(id),
    start: () => broadcast.start(targets).mode!,
  };
}
describe('explicit interactive input broadcasting', () => {
  it('starts without sending and sends only to the reviewed interactive sessions', () => {
    const state = fixture();
    // Two PTYs on the same account remain distinct recipients.
    state.change([state.targets()[0]!, { ...state.targets()[0]!, sessionId: randomUUID() }]);
    const mode = state.start();
    expect(state.write).not.toHaveBeenCalled();
    expect(() => state.start()).toThrow();
    state.broadcast.send(mode.id, { kind: 'line', text: 'pwd' });
    expect(state.write.mock.calls).toEqual(
      mode.targets.map((target) => [target.sessionId, { kind: 'text', data: 'pwd\r' }]),
    );
    mode.targets.length = 0;
    expect(state.broadcast.state().mode?.targets).toHaveLength(2);
    state.broadcast.stop();
    expect(() => state.broadcast.send(mode.id, { kind: 'enter' })).toThrow();
    const next = state.start();
    expect(next.id).not.toBe(mode.id);
    expect(() => state.broadcast.send(mode.id, { kind: 'line', text: 'stale' })).toThrow();
    expect(state.write).toHaveBeenCalledTimes(2);
  });
  it('rejects invalid or changed recipients before any input is sent', () => {
    const state = fixture();
    const original = state.targets();
    state.change([{ ...original[0]!, username: 'root' }, ...original.slice(1)]);
    expect(() => state.broadcast.start(original)).toThrow();
    expect(() => validateBroadcastTargets([])).toThrow();
    expect(() => validateBroadcastTargets([original[0], original[0]])).toThrow();
    expect(() => validateBroadcastTargets([{ ...original[0], password: 'private' }])).toThrow();
    expect(() => validateBroadcastTargets([{ ...original[0], sessionId: '../session' }])).toThrow();
    expect(() => validateBroadcastTargets(Array(2))).toThrow();
    expect(() => validateBroadcastTargets(Array(17).fill(original[0]))).toThrow();
    const mode = state.start();
    state.change(state.targets().slice(0, 2));
    expect(() => state.broadcast.send(mode.id, { kind: 'line', text: 'hostname' })).toThrow();
    expect(state.write).not.toHaveBeenCalled();
    expect(state.broadcast.state().mode).toBeNull();
  });
  it('disarms all recipients on disconnect and does not follow replacement sessions', () => {
    const state = fixture();
    const mode = state.start();
    state.close(mode.targets[1]!.sessionId);
    state.change([
      ...state.targets().slice(0, 2),
      { ...mode.targets[2]!, sessionId: randomUUID() },
    ]);
    expect(state.broadcast.state().mode).toBeNull();
    expect(() => state.broadcast.send(mode.id, { kind: 'interrupt' })).toThrow();
    expect(state.write).not.toHaveBeenCalled();
  });
  it('stops on a synchronous partial delivery failure without retry or remaining writes', () => {
    const state = fixture();
    const mode = state.start();
    state.write
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new Error('closed');
      });
    expect(() => state.broadcast.send(mode.id, { kind: 'line', text: 'touch marker' })).toThrow();
    expect(state.write).toHaveBeenCalledTimes(2);
    expect(state.broadcast.state().mode).toBeNull();
    expect(() => state.broadcast.send(mode.id, { kind: 'line', text: 'touch marker' })).toThrow();
    expect(state.write).toHaveBeenCalledTimes(2);
    state.broadcast.dispose();
    expect(state.unsubscribe).toHaveBeenCalledOnce();
    expect(state.broadcast.targets()).toEqual([]);
    expect(() => state.start()).toThrow();
  });
  it('does not deliver remaining input if a write synchronously signals a disconnect', () => {
    const state = fixture();
    const mode = state.start();
    state.write.mockImplementationOnce(() => state.close(mode.targets[0]!.sessionId));
    expect(() => state.broadcast.send(mode.id, { kind: 'enter' })).toThrow();
    expect(state.write).toHaveBeenCalledOnce();
    expect(state.broadcast.state().mode).toBeNull();
  });
});
describe('broadcast input boundary', () => {
  it('normalizes text and allows only deliberate Enter/Interrupt control actions', () => {
    expect(broadcastInput({ kind: 'line', text: 'echo one\r\necho two' })).toEqual({
      kind: 'text',
      data: 'echo one\necho two\r',
    });
    expect(broadcastInput({ kind: 'enter' })).toEqual({ kind: 'text', data: '\r' });
    expect(broadcastInput({ kind: 'interrupt' })).toEqual({ kind: 'text', data: '\x03' });
    for (const input of [
      null,
      { kind: 'text', data: 'bypass' },
      { kind: 'enter', extra: true },
      { kind: 'line', text: '' },
      { kind: 'line', text: 'a'.repeat(4097) },
      { kind: 'line', text: '\x1b[201~' },
      { kind: 'line', text: 'hidden\x03' },
    ])
      expect(() => broadcastInput(input)).toThrow();
  });
  it('reserves Ctrl/Cmd+Shift+B without swallowing ordinary terminal Ctrl+C or B', () => {
    const key = { key: 'B', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true };
    expect(isBroadcastStopShortcut(key)).toBe(true);
    expect(isBroadcastStopShortcut({ ...key, ctrlKey: false, metaKey: true })).toBe(true);
    for (const change of [{ shiftKey: false }, { altKey: true }, { metaKey: true }, { key: 'c' }])
      expect(isBroadcastStopShortcut({ ...key, ...change })).toBe(false);
  });
});
