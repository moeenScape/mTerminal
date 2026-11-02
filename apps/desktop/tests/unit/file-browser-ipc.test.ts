import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import type { TerminalRegistry } from '../../src/main/terminal/registry.js';
import { attachFiles } from '../../src/main/files/ipc.js';
import { FILES_LIST, FILES_MUTATE } from '../../src/shared/files.js';
import { transferChannels } from '../../src/shared/transfers.js';
import { tmpdir } from 'node:os';
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
  it('restricts transfer requests to the owning renderer and an active SSH session', async () => {
    const frame = { url: 'file:///renderer/index.html' };
    const contents = { mainFrame: frame, on: vi.fn(), send: vi.fn(), isDestroyed: () => false };
    const window = { webContents: contents, once: vi.fn() } as unknown as BrowserWindow;
    attachFiles(window, frame.url, {
      onSessionClosed: () => () => {},
      canTransfer: () => false,
    } as unknown as TerminalRegistry);
    const handler = fixture.handlers.get(transferChannels.enqueue)!;
    const event = { sender: contents, senderFrame: frame };
    const request = {
      sessionId: '04e9f162-d3cd-4c8f-a70a-2323a1751a9b',
      title: 'Fixture',
      direction: 'upload',
      localDirectory: tmpdir(),
      remoteDirectory: '/remote',
      name: 'file.txt',
    };
    await expect(handler({ ...event, sender: {} }, request)).rejects.toThrow('Unauthorized');
    await expect(handler(event, request)).resolves.toEqual({ ok: false, code: 'disconnected' });
    await expect(handler(event, { ...request, name: '../escape' })).resolves.toEqual({
      ok: false,
      code: 'unavailable',
    });
  });
  it('validates mutations and serializes them against reads and other changes', async () => {
    const frame = { url: 'file:///renderer/index.html' };
    const contents = { mainFrame: frame, on: vi.fn(), send: vi.fn(), isDestroyed: () => false };
    const window = { webContents: contents, once: vi.fn() } as unknown as BrowserWindow;
    let finish!: () => void;
    const mutateDirectory = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    attachFiles(window, frame.url, {
      mutateDirectory,
      onSessionClosed: () => () => {},
    } as unknown as TerminalRegistry);
    const handler = fixture.handlers.get(FILES_MUTATE)!;
    const event = { sender: contents, senderFrame: frame };
    const request = {
      side: 'remote',
      path: '/',
      sessionId: '04e9f162-d3cd-4c8f-a70a-2323a1751a9b',
      operation: { action: 'mkdir', name: 'folder' },
    };
    await expect(handler({ ...event, sender: {} }, request)).rejects.toThrow('Unauthorized');
    await expect(
      handler(event, { ...request, operation: { action: 'delete', name: '..' } }),
    ).rejects.toThrow('Invalid');
    const pending = handler(event, request);
    await expect(handler(event, request)).resolves.toEqual({ ok: false, code: 'busy' });
    await expect(
      fixture.handlers.get(FILES_LIST)!(event, { side: 'local', path: '' }),
    ).resolves.toEqual({ ok: false, code: 'busy' });
    finish();
    await expect(pending).resolves.toEqual({ ok: true });
    expect(mutateDirectory).toHaveBeenCalledWith(request.sessionId, '/', request.operation);
  });
  it('restricts the sender, validates paths, and routes only to an owned SSH session', async () => {
    const frame = { url: 'file:///renderer/index.html' };
    const contents = { mainFrame: frame, on: vi.fn(), send: vi.fn(), isDestroyed: () => false };
    const window = { webContents: contents, once: vi.fn() } as unknown as BrowserWindow;
    const listDirectory = vi.fn().mockRejectedValue({ code: 3 });
    attachFiles(window, frame.url, {
      listDirectory,
      onSessionClosed: () => () => {},
    } as unknown as TerminalRegistry);
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
