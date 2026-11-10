import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { attachBroadcast } from '../../src/main/terminal/broadcast-ipc.js';
import type { TerminalRegistry } from '../../src/main/terminal/registry.js';
import { broadcastChannels } from '../../src/shared/broadcast.js';
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), removeHandler: vi.fn() } }));
beforeEach(() => vi.resetAllMocks());
function fixture() {
  const frame = { url: 'file:///app/index.html' };
  const owner = {
    mainFrame: frame,
    isDestroyed: () => false,
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  };
  const window = {
    webContents: owner,
    once: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    isFocused: vi.fn(() => true),
  };
  const target = {
    sessionId: '04e9f162-d3cd-4c8f-a70a-2323a1751a9b',
    username: 'deploy',
    address: 'example.internal',
    port: 22,
    fingerprint: `SHA256:${'a'.repeat(43)}`,
  };
  const terminals = {
    executionTargets: () => [target],
    write: vi.fn(),
    onSessionClosed: vi.fn(() => vi.fn()),
  };
  const broadcast = attachBroadcast(
    window as unknown as BrowserWindow,
    frame.url,
    terminals as unknown as TerminalRegistry,
  );
  return {
    target,
    terminals,
    window,
    owner,
    broadcast,
    event: { sender: owner, senderFrame: frame } as unknown as IpcMainInvokeEvent,
    handler: (channel: string) =>
      vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)![1],
  };
}
describe('broadcast IPC and lifecycle', () => {
  it('rejects foreign senders, frames, bad arity and malformed input without delivery', () => {
    const state = fixture();
    for (const event of [
      { ...state.event, sender: {} },
      { ...state.event, senderFrame: { url: state.owner.mainFrame.url } },
    ])
      expect(() => state.handler(broadcastChannels.targets)(event as IpcMainInvokeEvent)).toThrow();
    expect(state.handler(broadcastChannels.targets)(state.event, 'extra')).toMatchObject({
      ok: false,
    });
    expect(
      state.handler(broadcastChannels.start)(state.event, [state.target], 'extra'),
    ).toMatchObject({ ok: false });
    const mode = state.broadcast.start([state.target]).mode!;
    expect(
      state.handler(broadcastChannels.send)(state.event, mode.id, {
        kind: 'text',
        data: 'private',
      }),
    ).toEqual({ ok: false, code: 'broadcast-failed' });
    expect(
      state.handler(broadcastChannels.send)(state.event, '../mode', { kind: 'enter' }),
    ).toMatchObject({ ok: false });
    expect(state.terminals.write).not.toHaveBeenCalled();
  });
  it('disarms on blur, navigation and crash, and refuses sends from an unfocused window', () => {
    const state = fixture();
    for (const name of ['did-navigate', 'render-process-gone']) {
      state.broadcast.start([state.target]);
      state.owner.on.mock.calls.find(([event]) => event === name)![1]();
      expect(state.broadcast.state().mode).toBeNull();
    }
    state.broadcast.start([state.target]);
    state.window.on.mock.calls.find(([event]) => event === 'blur')![1]();
    expect(state.broadcast.state().mode).toBeNull();
    const mode = state.broadcast.start([state.target]).mode!;
    state.window.isFocused.mockReturnValue(false);
    expect(
      state.handler(broadcastChannels.send)(state.event, mode.id, { kind: 'enter' }),
    ).toMatchObject({ ok: false });
    expect(state.broadcast.state().mode).toBeNull();
    expect(state.terminals.write).not.toHaveBeenCalled();
    expect(state.handler(broadcastChannels.start)(state.event, [state.target])).toMatchObject({
      ok: false,
    });
  });
  it('consumes the immediate stop shortcut and releases native listeners and IPC on close', () => {
    const state = fixture();
    state.broadcast.start([state.target]);
    const preventDefault = vi.fn();
    const key = state.owner.on.mock.calls.find(([event]) => event === 'before-input-event')![1];
    key(
      { preventDefault },
      { type: 'keyDown', key: 'b', control: true, meta: false, alt: false, shift: true },
    );
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(state.broadcast.state().mode).toBeNull();
    expect(state.terminals.write).not.toHaveBeenCalled();
    state.window.once.mock.calls.find(([event]) => event === 'closed')![1]();
    expect(vi.mocked(ipcMain.removeHandler).mock.calls.map(([name]) => name)).toEqual(
      Object.values(broadcastChannels),
    );
    expect(state.owner.off).toHaveBeenCalledTimes(3);
    expect(state.window.off).toHaveBeenCalledOnce();
  });
});
