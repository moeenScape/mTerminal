import { EventEmitter } from 'node:events';
import type { Client, FileEntryWithStats, SFTPWrapper, Stats } from 'ssh2';
import { describe, expect, it, vi } from 'vitest';
import { RemoteFileBrowser } from '../../src/main/files/remote.js';
import { FILE_LIST_LIMIT } from '../../src/shared/files.js';

function fixture(batches: FileEntryWithStats[][]) {
  const channel = Object.assign(new EventEmitter(), {
    realpath: vi.fn((_path: string, done: (error: undefined, path: string) => void) =>
      done(undefined, '/home/user'),
    ),
    opendir: vi.fn((_path: string, done: (error: undefined, handle: Buffer) => void) =>
      done(undefined, Buffer.from('handle')),
    ),
    readdir: vi.fn(
      (_handle: Buffer, done: (error: Error | undefined, list?: FileEntryWithStats[]) => void) => {
        const batch = batches.shift();
        if (batch) done(undefined, batch);
        else done(Object.assign(new Error('EOF'), { code: 1 }));
      },
    ),
    close: vi.fn((_handle: Buffer, done: () => void) => done()),
    lstat: vi.fn((_path: string, done: (error: Error | undefined, stats?: Stats) => void) =>
      done(undefined, entry('item').attrs),
    ),
    mkdir: vi.fn((_path: string, done: () => void) => done()),
    rename: vi.fn((_from: string, _to: string, done: () => void) => done()),
    unlink: vi.fn((_path: string, done: () => void) => done()),
    rmdir: vi.fn((_path: string, done: () => void) => done()),
    chmod: vi.fn((_path: string, _mode: number, done: () => void) => done()),
    destroy: vi.fn(),
  });
  const client = {
    sftp: vi.fn((done: (error: undefined, channel: SFTPWrapper) => void) =>
      done(undefined, channel as unknown as SFTPWrapper),
    ),
  };
  return { channel, browser: new RemoteFileBrowser(client as unknown as Client) };
}
const entry = (filename: string, mode = 0o100644) =>
  ({
    filename,
    longname: filename,
    attrs: { mode, size: 12, mtime: 1700000000, atime: 1700000000, uid: 1000, gid: 1000 },
  }) as FileEntryWithStats;

describe('SFTP directory lifecycle', () => {
  it('creates folders and changes ordinary modes on the existing SFTP channel', async () => {
    const { channel, browser } = fixture([]);
    await browser.mutate('/home/user', { action: 'mkdir', name: 'new folder' });
    expect(channel.mkdir).toHaveBeenCalledWith('/home/user/new folder', expect.any(Function));
    await browser.mutate('/home/user', { action: 'chmod', name: 'file', mode: '0640' });
    expect(channel.chmod).toHaveBeenCalledWith('/home/user/file', 0o640, expect.any(Function));
    expect(channel.destroy).toHaveBeenCalledTimes(2);
  });
  it('refuses existing rename destinations and uses standard rename for a free name', async () => {
    const { channel, browser } = fixture([]);
    await expect(
      browser.mutate('/home/user', { action: 'rename', name: 'before', newName: 'existing' }),
    ).rejects.toMatchObject({ code: 'exists' });
    expect(channel.rename).not.toHaveBeenCalled();
    channel.lstat.mockImplementation((path, done) => {
      if (path.endsWith('/after')) done(Object.assign(new Error('Missing'), { code: 2 }));
      else done(undefined, entry('before').attrs);
    });
    await browser.mutate('/home/user', { action: 'rename', name: 'before', newName: 'after' });
    expect(channel.rename).toHaveBeenCalledWith(
      '/home/user/before',
      '/home/user/after',
      expect.any(Function),
    );
  });
  it('unlinks symlinks without changing their targets and uses rmdir only for folders', async () => {
    const { channel, browser } = fixture([]);
    channel.lstat.mockImplementation((_path, done) =>
      done(undefined, entry('link', 0o120777).attrs),
    );
    await expect(
      browser.mutate('/home/user', { action: 'chmod', name: 'link', mode: '0777' }),
    ).rejects.toMatchObject({ code: 'unsupported' });
    expect(channel.chmod).not.toHaveBeenCalled();
    await browser.mutate('/home/user', { action: 'delete', name: 'link' });
    expect(channel.unlink).toHaveBeenCalledWith('/home/user/link', expect.any(Function));
    expect(channel.rmdir).not.toHaveBeenCalled();
    channel.lstat.mockImplementation((_path, done) =>
      done(undefined, entry('folder', 0o040755).attrs),
    );
    await browser.mutate('/home/user', { action: 'delete', name: 'folder' });
    expect(channel.rmdir).toHaveBeenCalledWith('/home/user/folder', expect.any(Function));
  });
  it('reports an uncertain outcome if a mutation is interrupted rather than claiming failure', async () => {
    const { channel, browser } = fixture([]);
    channel.mkdir.mockImplementation(() => {});
    const pending = browser.mutate('/home/user', { action: 'mkdir', name: 'new folder' });
    const rejected = expect(pending).rejects.toMatchObject({ code: 'uncertain' });
    await vi.waitFor(() => expect(channel.mkdir).toHaveBeenCalled());
    browser.dispose();
    await rejected;
  });
  it('continues after an empty batch and treats status 1 as EOF, preserving links and metadata', async () => {
    const { channel, browser } = fixture([
      [],
      [entry('.hidden'), entry('folder', 0o040755), entry('link', 0o120777)],
    ]);
    const result = await browser.list('');
    expect(channel.realpath).toHaveBeenCalledWith('.', expect.any(Function));
    expect(result.entries.map((item) => item.kind)).toEqual(['file', 'directory', 'symlink']);
    expect(result.entries[0]).toMatchObject({
      path: '/home/user/.hidden',
      modified: 1700000000000,
      permissions: '0644',
    });
    expect(result.parent).toBe('/home');
    expect(channel.close).toHaveBeenCalledOnce();
    expect(channel.destroy).toHaveBeenCalledOnce();
    expect(result.truncated).toBe(false);
  });
  it('bounds large directories and closes the remote handle', async () => {
    const { channel, browser } = fixture([
      Array.from({ length: FILE_LIST_LIMIT + 1 }, (_, i) => entry(`file-${i}`)),
    ]);
    const result = await browser.list('/');
    expect(result.entries).toHaveLength(FILE_LIST_LIMIT);
    expect(result.truncated).toBe(true);
    expect(channel.close).toHaveBeenCalledOnce();
  });
  it('rejects server-supplied path fragments and still closes the handle', async () => {
    const { channel, browser } = fixture([[entry('../escape')]]);
    await expect(browser.list('/')).rejects.toMatchObject({ code: 'unavailable' });
    expect(channel.close).toHaveBeenCalledOnce();
    expect(channel.destroy).toHaveBeenCalledOnce();
  });
  it('rejects overlapping reads and cancels outstanding requests on disconnect', async () => {
    const { channel, browser } = fixture([]);
    channel.realpath.mockImplementation(() => {});
    const pending = browser.list('/');
    const rejected = expect(pending).rejects.toMatchObject({ code: 'disconnected' });
    await expect(browser.list('/')).rejects.toMatchObject({ code: 'busy' });
    browser.dispose();
    await rejected;
    expect(channel.destroy).toHaveBeenCalled();
    await expect(browser.list('/')).rejects.toMatchObject({ code: 'disconnected' });
  });
  it('times out a stalled channel without closing the SSH client', async () => {
    vi.useFakeTimers();
    const { channel, browser } = fixture([]);
    channel.realpath.mockImplementation(() => {});
    try {
      const pending = browser.list('/');
      const rejected = expect(pending).rejects.toMatchObject({ code: 'unavailable' });
      await vi.advanceTimersByTimeAsync(15000);
      await rejected;
      expect(channel.destroy).toHaveBeenCalled();
    } finally {
      browser.dispose();
      vi.useRealTimers();
    }
  });
});
