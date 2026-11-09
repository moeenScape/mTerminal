import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { attachBatch } from '../../src/main/terminal/batch-ipc.js';
import type { TerminalRegistry } from '../../src/main/terminal/registry.js';
import { batchChannels } from '../../src/shared/batch.js';
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
  const window = { webContents: owner, once: vi.fn() };
  const target = {
    sessionId: '04e9f162-d3cd-4c8f-a70a-2323a1751a9b',
    username: 'deploy',
    address: 'example.internal',
    port: 22,
    fingerprint: `SHA256:${'a'.repeat(43)}`,
  };
  const terminals = {
    executionTargets: vi.fn(() => [target]),
    executeCommand: vi.fn().mockResolvedValue({
      status: 'succeeded',
      stdout: '',
      stderr: '',
      exitCode: 0,
      exitSignal: null,
    }),
  };
  attachBatch(
    window as unknown as BrowserWindow,
    frame.url,
    terminals as unknown as TerminalRegistry,
  );
  return {
    target,
    terminals,
    window,
    owner,
    event: { sender: owner, senderFrame: frame } as unknown as IpcMainInvokeEvent,
    handler: (channel: string) =>
      vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)![1],
  };
}
describe('batch IPC ownership', () => {
  it('rejects other frames, bad arity and invalid payloads before any command is sent', async () => {
    const state = fixture();
    expect(() =>
      state.handler(batchChannels.targets)({
        ...state.event,
        senderFrame: { url: 'https://untrusted.invalid' },
      } as unknown as IpcMainInvokeEvent),
    ).toThrow();
    expect(state.handler(batchChannels.targets)(state.event, 'extra')).toMatchObject({ ok: false });
    expect(
      state.handler(batchChannels.prepare)(state.event, {
        command: 'private command',
        sessionIds: ['../session'],
      }),
    ).toEqual({ ok: false, code: 'batch-failed' });
    expect(state.terminals.executeCommand).not.toHaveBeenCalled();
  });
  it('makes a reviewed token one-use and cleans channels on window disposal', async () => {
    const state = fixture();
    const prepared = state.handler(batchChannels.prepare)(state.event, {
      command: 'hostname',
      sessionIds: [state.target.sessionId],
    }) as { ok: true; value: { token: string } };
    expect(state.terminals.executeCommand).not.toHaveBeenCalled();
    expect(state.handler(batchChannels.start)(state.event, prepared.value.token)).toMatchObject({
      ok: true,
    });
    expect(state.handler(batchChannels.start)(state.event, prepared.value.token)).toMatchObject({
      ok: false,
    });
    expect(state.terminals.executeCommand).toHaveBeenCalledOnce();
    state.window.once.mock.calls.find(([event]) => event === 'closed')![1]();
    expect(vi.mocked(ipcMain.removeHandler).mock.calls.map(([channel]) => channel)).toEqual(
      Object.values(batchChannels),
    );
  });
});
