import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import type { TerminalRegistry } from '../../src/main/terminal/registry.js';
import { attachFiles } from '../../src/main/files/ipc.js';
import { FILES_LIST, FILES_MUTATE } from '../../src/shared/files.js';
import { transferChannels } from '../../src/shared/transfers.js';
import { remoteEditChannels } from '../../src/shared/remote-edit.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const fixture = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  close: [] as (() => void)[],
}));
vi.mock('electron', () => ({
  shell: { openPath: vi.fn(async () => '') },
  ipcMain: {
    handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) =>
      fixture.handlers.set(name, handler),
    removeHandler: (name: string) => fixture.handlers.delete(name),
  },
}));
afterEach(() => {
  for (const close of fixture.close.splice(0)) close();
  fixture.handlers.clear();
});
describe('file browser IPC', () => {
  it('restricts transfer requests to the owning renderer and an active SSH session', async () => {
    const frame = { url: 'file:///renderer/index.html' };
    const contents = { mainFrame: frame, on: vi.fn(), send: vi.fn(), isDestroyed: () => false };
    const window = {
      webContents: contents,
      once: vi.fn((name: string, close: () => void) => {
        if (name === 'closed') fixture.close.push(close);
      }),
    } as unknown as BrowserWindow;
    attachFiles(
      window,
      frame.url,
      {
        onSessionClosed: () => () => {},
        canTransfer: () => false,
      } as unknown as TerminalRegistry,
      join(tmpdir(), 'unused-remote-edit-root'),
      { list: () => [], save: () => {}, forget: () => {} },
    );
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
    const editStart = fixture.handlers.get(remoteEditChannels.start)!;
    const editRequest = {
      sessionId: request.sessionId,
      title: request.title,
      remoteDirectory: '/remote',
      name: 'config.sh',
    };
    await expect(editStart({ ...event, sender: {} }, editRequest)).rejects.toThrow('Unauthorized');
    await expect(editStart(event, editRequest)).resolves.toEqual({
      ok: false,
      code: 'disconnected',
    });
    await expect(
      editStart(event, { ...editRequest, localPath: '/tmp/forged.txt' }),
    ).resolves.toEqual({ ok: false, code: 'unavailable' });
    await expect(
      fixture.handlers.get(remoteEditChannels.reopen)!(event, '/tmp/forged.txt'),
    ).resolves.toEqual({ ok: false, code: 'unavailable' });
    await expect(
      fixture.handlers.get(remoteEditChannels.finish)!(event, { choice: 'discard', path: '/' }),
    ).resolves.toEqual({ ok: false, code: 'unavailable' });
    await expect(handler({ ...event, sender: {} }, request)).rejects.toThrow('Unauthorized');
    await expect(handler(event, request)).resolves.toEqual({ ok: false, code: 'disconnected' });
    await expect(handler(event, { ...request, name: '../escape' })).resolves.toEqual({
      ok: false,
      code: 'unavailable',
    });
    const recovery = fixture.handlers.get(transferChannels.recovery)!;
    const forget = fixture.handlers.get(transferChannels.forget)!;
    await expect(recovery({ ...event, sender: {} })).rejects.toThrow('Unauthorized');
    await expect(recovery(event, '/forged/path')).resolves.toEqual({
      ok: false,
      code: 'unavailable',
    });
    await expect(forget({ ...event, sender: {} }, request.sessionId)).rejects.toThrow(
      'Unauthorized',
    );
    await expect(forget(event, '/forged/path')).resolves.toEqual({
      ok: false,
      code: 'unavailable',
    });
    await expect(forget(event, request.sessionId, { deleteFiles: true })).resolves.toEqual({
      ok: false,
      code: 'unavailable',
    });
    const resolve = fixture.handlers.get(transferChannels.resolve)!;
    await expect(
      resolve({ ...event, sender: {} }, request.sessionId, request.sessionId, 'replace'),
    ).rejects.toThrow('Unauthorized');
    await expect(resolve(event, request.sessionId, request.sessionId, 'replace')).resolves.toEqual({
      ok: false,
      code: 'destination-changed',
    });
    await expect(
      resolve(event, request.sessionId, request.sessionId, 'replace-all'),
    ).resolves.toEqual({ ok: false, code: 'unavailable' });
  });
  it('validates mutations and serializes them against reads and other changes', async () => {
    const frame = { url: 'file:///renderer/index.html' };
    const contents = { mainFrame: frame, on: vi.fn(), send: vi.fn(), isDestroyed: () => false };
    const window = {
      webContents: contents,
      once: vi.fn((name: string, close: () => void) => {
        if (name === 'closed') fixture.close.push(close);
      }),
    } as unknown as BrowserWindow;
    let finish!: () => void;
    const mutateDirectory = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    attachFiles(
      window,
      frame.url,
      {
        mutateDirectory,
        onSessionClosed: () => () => {},
      } as unknown as TerminalRegistry,
      join(tmpdir(), 'unused-remote-edit-root'),
      { list: () => [], save: () => {}, forget: () => {} },
    );
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
    const window = {
      webContents: contents,
      once: vi.fn((name: string, close: () => void) => {
        if (name === 'closed') fixture.close.push(close);
      }),
    } as unknown as BrowserWindow;
    const listDirectory = vi.fn().mockRejectedValue({ code: 3 });
    attachFiles(
      window,
      frame.url,
      {
        listDirectory,
        onSessionClosed: () => () => {},
      } as unknown as TerminalRegistry,
      join(tmpdir(), 'unused-remote-edit-root'),
      { list: () => [], save: () => {}, forget: () => {} },
    );
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
