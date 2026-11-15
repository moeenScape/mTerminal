import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { attachSessionLogs } from '../../src/main/session-logs.js';
import type { TerminalRegistry } from '../../src/main/terminal/registry.js';
import type { SshSecretStore } from '../../src/main/storage/secret-store.js';
import {
  sessionLogChannels as channels,
  SESSION_LOGS_CHANGED,
  type SessionLog,
} from '../../src/shared/session-logs.js';
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), removeHandler: vi.fn() } }));
beforeEach(() => vi.resetAllMocks());
const id = '04e9f162-d3cd-4c8f-a70a-2323a1751a9b';
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
  const logs: SessionLog[] = [];
  const secrets = {
    saveSessionLog: vi.fn(async (log: SessionLog) => {
      const index = logs.findIndex((l) => l.id === log.id);
      if (index < 0) logs.push(log);
      else logs[index] = log;
    }),
    listSessionLogs: vi.fn(async () => logs),
    annotateSessionLog: vi.fn().mockResolvedValue(undefined),
    deleteSessionLog: vi.fn().mockResolvedValue(undefined),
  };
  const off = vi.fn();
  const terminals = {
    isReady: vi.fn(() => true),
    onOutput: vi.fn((callback: (id: string, data: string) => void) => {
      void callback;
      return off;
    }),
    onSessionClosed: vi.fn((callback: (id: string) => void) => {
      void callback;
      return off;
    }),
  };
  const recorder = attachSessionLogs(
    window as unknown as BrowserWindow,
    frame.url,
    terminals as unknown as TerminalRegistry,
    secrets as unknown as SshSecretStore,
  );
  const handler = (channel: string) =>
    vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)![1];
  return {
    secrets,
    owner,
    window,
    logs,
    recorder,
    terminals,
    off,
    handler,
    event: { sender: owner, senderFrame: frame } as unknown as IpcMainInvokeEvent,
  };
}
describe('session log IPC ownership', () => {
  it('rejects foreign senders/frames and malformed requests before reading or capturing', async () => {
    const f = fixture();
    try {
      for (const event of [
        { ...f.event, sender: {} },
        { ...f.event, senderFrame: { url: f.event.senderFrame?.url } },
      ])
        await expect(f.handler(channels.list)(event as IpcMainInvokeEvent)).rejects.toThrow();
      expect(f.secrets.listSessionLogs).not.toHaveBeenCalled();
      for (const [channel, args] of [
        [channels.list, ['extra']],
        [channels.start, [id, 'Title', 'extra']],
        [channels.start, ['../session', 'Title']],
        [channels.read, ['../log']],
        [channels.stop, [id]],
      ] as const)
        expect(await f.handler(channel)(f.event, ...args)).toEqual({
          ok: false,
          code: 'session-log-failed',
        });
      expect(f.secrets.saveSessionLog).not.toHaveBeenCalled();
      f.terminals.isReady.mockReturnValue(false);
      expect(await f.handler(channels.start)(f.event, id, 'Title')).toMatchObject({ ok: false });
    } finally {
      await f.recorder.dispose();
    }
  });
  it('returns metadata separately, protects active mutations and never signals transcript contents', async () => {
    const f = fixture();
    try {
      expect(await f.handler(channels.start)(f.event, id, 'Local')).toMatchObject({ ok: true });
      const log = f.logs[0]!;
      f.terminals.onOutput.mock.calls[0]![0](id, 'private output');
      expect(
        await f.handler(channels.annotate)(f.event, log.id, { notes: '', bookmarks: [] }),
      ).toMatchObject({ ok: false });
      expect(await f.handler(channels.delete)(f.event, log.id)).toMatchObject({ ok: false });
      expect(f.secrets.deleteSessionLog).not.toHaveBeenCalled();
      await f.handler(channels.stop)(f.event);
      const result = await f.handler(channels.list)(f.event);
      expect(result).toEqual({
        ok: true,
        value: [expect.objectContaining({ id: log.id, characters: 14 })],
      });
      expect(JSON.stringify(result)).not.toContain('private output');
      expect(result.value[0]).not.toHaveProperty('text');
      expect(result.value[0]).not.toHaveProperty('notes');
      expect(await f.handler(channels.read)(f.event, log.id)).toMatchObject({
        ok: true,
        value: { text: 'private output' },
      });
      expect(
        f.owner.send.mock.calls.every(
          (call) => call.length === 1 && call[0] === SESSION_LOGS_CHANGED,
        ),
      ).toBe(true);
      f.secrets.listSessionLogs.mockRejectedValueOnce(new Error('private disk detail'));
      expect(await f.handler(channels.list)(f.event)).toEqual({
        ok: false,
        code: 'session-log-failed',
      });
    } finally {
      await f.recorder.dispose();
    }
  });
  it('disarms on renderer navigation and removes owned handlers/listeners on close', async () => {
    const f = fixture();
    try {
      await f.recorder.start(id, 'Local');
      f.owner.on.mock.calls.find(([event]) => event === 'did-navigate')![1]();
      await f.recorder.stop();
      expect(f.recorder.state().active).toBeNull();
      f.window.once.mock.calls.find(([event]) => event === 'closed')![1]();
      await f.recorder.stop();
      expect(ipcMain.removeHandler).toHaveBeenCalledTimes(Object.keys(channels).length);
      expect(f.owner.off).toHaveBeenCalledTimes(2);
      expect(f.off).toHaveBeenCalledTimes(2);
    } finally {
      await f.recorder.dispose();
    }
  });
});
