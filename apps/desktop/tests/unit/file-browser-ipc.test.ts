import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import type { TerminalRegistry } from '../../src/main/terminal/registry.js';
import { attachFiles } from '../../src/main/files/ipc.js';
import { FILES_LIST } from '../../src/shared/files.js';
const fixture = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
}));
vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) =>
      fixture.handlers.set(name, handler),
    removeHandler: (name: string) => fixture.handlers.delete(name),
  },
}));
describe('file browser IPC', () => {
  it('restricts the sender, validates paths, and routes only to an owned SSH session', async () => {
    const frame = { url: 'file:///renderer/index.html' };
    const contents = { mainFrame: frame };
    const window = { webContents: contents, once: vi.fn() } as unknown as BrowserWindow;
    const listDirectory = vi.fn().mockRejectedValue({ code: 3 });
    attachFiles(window, frame.url, { listDirectory } as unknown as TerminalRegistry);
    const handler = fixture.handlers.get(FILES_LIST)!;
    const event = { sender: contents, senderFrame: frame };
    await expect(handler({ ...event, sender: {} }, { side: 'local', path: '' })).rejects.toThrow(
      'Unauthorized',
    );
    await expect(handler(event, { side: 'local', path: '../escape' })).rejects.toThrow('Invalid');
    const sessionId = '04e9f162-d3cd-4c8f-a70a-2323a1751a9b';
    await expect(handler(event, { side: 'remote', sessionId, path: '/' })).resolves.toEqual({
      ok: false,
      code: 'permission',
    });
    expect(listDirectory).toHaveBeenCalledWith(sessionId, '/');
  });
});
