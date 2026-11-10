import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import type { LocalDatabase } from '../../src/main/storage/database.js';
import type { SshSecretStore } from '../../src/main/storage/secret-store.js';
import type { DiagnosticLog } from '../../src/main/diagnostics.js';
import { attachTerminal } from '../../src/main/terminal/ipc.js';

const fixture = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  complete: vi.fn(async () => [{ command: 'cat ./fixture.txt', directory: false }]),
  data: (() => {}) as (value: string) => void,
}));
vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) =>
      fixture.handlers.set(name, handler),
    on: vi.fn(),
    removeHandler: vi.fn(),
    removeAllListeners: vi.fn(),
  },
}));
vi.mock('../../src/main/terminal/path-completion.js', () => ({
  completeLocalPaths: fixture.complete,
}));
vi.mock('node-pty', () => ({
  spawn: () => ({
    resize: vi.fn(),
    write: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    kill: vi.fn(),
    onData: (listener: (data: string) => void) => {
      fixture.data = listener;
      return { dispose: vi.fn() };
    },
    onExit: () => ({ dispose: vi.fn() }),
  }),
}));
vi.mock('../../src/main/terminal/shells.js', () => ({
  chooseShell: async () => '/bin/bash',
  discoverShells: async () => [],
}));
vi.mock('../../src/main/terminal/bash-history.js', async (original) => ({
  ...(await original<typeof import('../../src/main/terminal/bash-history.js')>()),
  bashHistoryRc: async () => ({
    token: 'fixture',
    path: '/unused/bashrc',
    dispose: async () => {},
  }),
}));

describe('history recording notifications', () => {
  it('refreshes history only after persistence succeeds and reports a failed save without closing the shell', async () => {
    const url = 'file:///renderer/index.html';
    const frame = { url };
    const send = vi.fn();
    const contents = { mainFrame: frame, send, on: vi.fn(), isDestroyed: () => false };
    const window = { webContents: contents, once: vi.fn() } as unknown as BrowserWindow;
    let saved!: () => void;
    const record = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          saved = resolve;
        }),
    );
    let locked = false;
    const secrets = {
      recordCommand: record,
      vaultStatus: async () => ({ configured: true, locked, available: true }),
    } as unknown as SshSecretStore;
    const registry = attachTerminal(
      window,
      url,
      () => '',
      { record: vi.fn() } as unknown as DiagnosticLog,
      {} as LocalDatabase,
      secrets,
    );
    const event = { sender: contents, senderFrame: frame };
    const id = '04e9f162-d3cd-4c8f-a70a-2323a1751a9b';
    try {
      expect(
        await fixture.handlers.get('terminal:open')!(event, id, { cols: 80, rows: 24 }),
      ).toEqual({ ok: true });
      expect(send).toHaveBeenCalledWith('terminal:event', {
        kind: 'history-status',
        id,
        status: 'starting',
      });
      send.mockClear();
      const command = '\x1b]777;fixture;H;L3RtcA==;ZWNobyBoaQ==\x07';
      fixture.data(command);
      await vi.waitFor(() => expect(record).toHaveBeenCalledWith('echo hi', '/tmp'));
      expect(send).not.toHaveBeenCalled();
      saved();
      await vi.waitFor(() => expect(send).toHaveBeenCalledWith('history:changed'));
      send.mockClear();
      record.mockRejectedValueOnce(new Error('unavailable'));
      fixture.data(command);
      await vi.waitFor(() =>
        expect(send).toHaveBeenCalledWith('terminal:event', {
          kind: 'history-error',
          id,
          code: 'vault-unavailable',
        }),
      );
      expect(send).not.toHaveBeenCalledWith('history:changed');
      // A locked vault skips saving without reporting an error.
      locked = true;
      send.mockClear();
      record.mockClear();
      fixture.data(command);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(record).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
      fixture.data('\x1b]777;fixture;C\x07\x1b]777;fixture;P;L3RtcA==;7\x07');
      await vi.waitFor(() =>
        expect(send).toHaveBeenCalledWith('terminal:event', {
          kind: 'data',
          id,
          data: `\x1b]777;mterminal;${id};C\x07\x1b]777;mterminal;${id};P;L3RtcA==;7\x07`,
        }),
      );
      expect(record).not.toHaveBeenCalled();
      const complete = fixture.handlers.get('terminal:complete-paths')!;
      expect(await complete(event, id, 'cat ./fi')).toEqual({
        ok: true,
        value: [{ command: 'cat ./fixture.txt', directory: false, prompt: expect.any(Number) }],
      });
      expect(fixture.complete).toHaveBeenCalledWith('/tmp', 'cat ./fi', undefined);
      expect(await complete(event, '../id', 'cat ./fi')).toMatchObject({ ok: false });
      expect(await complete(event, id, 'cat ./fi', '/arbitrary-directory')).toMatchObject({
        ok: false,
      });
      expect(await complete(event, id, 'x'.repeat(4097))).toMatchObject({ ok: false });
      await expect(complete({ sender: {}, senderFrame: frame }, id, 'cat ./fi')).rejects.toThrow();
      registry.write(id, { kind: 'text', data: '\r' });
      expect(await complete(event, id, 'cat ./fi')).toEqual({ ok: true, value: [] });
      fixture.data('\x1b]777;fixture;P;L3RtcA==;0\x07');
      fixture.data('\x1b]777;fixture;C\x07');
      expect(await complete(event, id, 'cat ./fi')).toEqual({ ok: true, value: [] });
      fixture.data('\x1b]777;fixture;P;L3RtcA==;0\x07');
      let release!: (rows: { command: string; directory: boolean }[]) => void;
      fixture.complete.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
      const pending = complete(event, id, 'cat ./fi');
      fixture.data('\x1b]777;fixture;C\x07');
      release([{ command: 'cat ./old.txt', directory: false }]);
      expect(await pending).toEqual({ ok: true, value: [] });
      registry.close(id);
      expect(await complete(event, id, 'cat ./fi')).toEqual({ ok: true, value: [] });
      expect(registry.count).toBe(0);
    } finally {
      registry.dispose();
    }
  });
});
