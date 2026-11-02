import { EventEmitter } from 'node:events';
import { writeFileSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client, SFTPWrapper, Stats } from 'ssh2';
import { describe, expect, it, vi } from 'vitest';
import { transferFile } from '../../src/main/files/transfer-file.js';
import { FileBrowserError } from '../../src/main/files/listing.js';
import type { TransferRequest } from '../../src/shared/transfers.js';

function remoteFixture(initial: Record<string, Buffer> = {}) {
  const files = new Map(Object.entries(initial));
  const handles = new Map<string, string>();
  const metadata = (path: string) =>
    ({ mode: 0o100600, size: files.get(path)!.length, mtime: 1700000000 }) as Stats;
  const missing = () => Object.assign(new Error('Missing'), { code: 2 });
  let next = 0;
  const channel = Object.assign(new EventEmitter(), {
    realpath: (_path: string, done: (error: undefined, path: string) => void) =>
      done(undefined, '/remote'),
    lstat: (path: string, done: (error: Error | undefined, stats?: Stats) => void) =>
      files.has(path) ? done(undefined, metadata(path)) : done(missing()),
    open: (
      path: string,
      flags: string,
      mode: number | ((error: Error | undefined, handle?: Buffer) => void),
      callback?: (error: Error | undefined, handle?: Buffer) => void,
    ) => {
      const done = typeof mode === 'function' ? mode : callback!;
      if (flags === 'wx' && files.has(path)) {
        done(Object.assign(new Error('Exists'), { code: 11 }));
        return;
      }
      if (flags === 'r' && !files.has(path)) {
        done(missing());
        return;
      }
      if (flags === 'wx') files.set(path, Buffer.alloc(0));
      const handle = String(++next);
      handles.set(handle, path);
      done(undefined, Buffer.from(handle));
    },
    fstat: (handle: Buffer, done: (error: undefined, stats: Stats) => void) =>
      done(undefined, metadata(handles.get(handle.toString())!)),
    read: (
      handle: Buffer,
      buffer: Buffer,
      offset: number,
      length: number,
      position: number,
      done: (error: undefined, count: number) => void,
    ) => {
      const source = files.get(handles.get(handle.toString())!)!;
      const count =
        position >= source.length
          ? 0
          : source.copy(buffer, offset, position, position + Math.min(length, 8192));
      done(undefined, count);
    },
    write: vi.fn(
      (
        handle: Buffer,
        buffer: Buffer,
        offset: number,
        length: number,
        position: number,
        done: () => void,
      ) => {
        const path = handles.get(handle.toString())!;
        const before = files.get(path)!;
        const output = Buffer.alloc(Math.max(before.length, position + length));
        before.copy(output);
        buffer.copy(output, position, offset, offset + length);
        files.set(path, output);
        done();
      },
    ),
    close: (handle: Buffer, done: () => void) => {
      handles.delete(handle.toString());
      done();
    },
    rename: vi.fn((from: string, to: string, done: (error?: Error) => void) => {
      if (files.has(to)) {
        done(Object.assign(new Error('Exists'), { code: 11 }));
        return;
      }
      files.set(to, files.get(from)!);
      files.delete(from);
      done();
    }),
    unlink: vi.fn((path: string, done: (error?: Error) => void) => {
      if (!files.delete(path)) done(missing());
      else done();
    }),
    destroy: vi.fn(),
  });
  const client = {
    sftp: (done: (error: undefined, channel: SFTPWrapper) => void) =>
      done(undefined, channel as unknown as SFTPWrapper),
  } as unknown as Client;
  return { client, channel, files, handles };
}
const request = (
  localDirectory: string,
  direction: 'upload' | 'download' = 'upload',
): TransferRequest => ({
  sessionId: '04e9f162-d3cd-4c8f-a70a-2323a1751a9b',
  title: 'Fixture',
  direction,
  localDirectory,
  remoteDirectory: '/remote',
  name: 'sample.bin',
});

describe('staged SFTP transfers', () => {
  it('preserves destinations created while copying instead of overwriting them at publication', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mterminal-transfer-race-'));
    const remote = remoteFixture();
    try {
      await writeFile(join(directory, 'sample.bin'), 'upload source');
      await expect(
        transferFile(remote.client, request(directory), new AbortController().signal, (count) => {
          if (count) remote.files.set('/remote/sample.bin', Buffer.from('concurrent destination'));
        }),
      ).rejects.toMatchObject({ code: 'exists' });
      expect(remote.files.get('/remote/sample.bin')?.toString()).toBe('concurrent destination');
      expect([...remote.files.keys()]).toEqual(['/remote/sample.bin']);
      await rm(join(directory, 'sample.bin'));
      await expect(
        transferFile(
          remote.client,
          request(directory, 'download'),
          new AbortController().signal,
          () => {
            writeFileSync(join(directory, 'sample.bin'), 'local concurrent destination');
          },
        ),
      ).rejects.toMatchObject({ code: 'exists' });
      expect(await readFile(join(directory, 'sample.bin'), 'utf8')).toBe(
        'local concurrent destination',
      );
      expect(await readdir(directory)).toEqual(['sample.bin']);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('rejects a changing download source and removes the incomplete local staging file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mterminal-transfer-change-'));
    const remote = remoteFixture({ '/remote/sample.bin': Buffer.alloc(40000, 7) });
    try {
      await expect(
        transferFile(
          remote.client,
          request(directory, 'download'),
          new AbortController().signal,
          (count) => {
            if (count) remote.files.set('/remote/sample.bin', Buffer.alloc(0));
          },
        ),
      ).rejects.toMatchObject({ code: 'source-changed' });
      expect(await readdir(directory)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('streams multiple chunks and publishes exact bytes without leaving handles or staging files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mterminal-transfer-'));
    const bytes = Buffer.alloc(192 * 1024 + 31, 0xa5);
    const remote = remoteFixture();
    try {
      await writeFile(join(directory, 'sample.bin'), bytes);
      const progress = vi.fn();
      await expect(
        transferFile(remote.client, request(directory), new AbortController().signal, progress),
      ).resolves.toEqual({ partialPath: null });
      expect(remote.files.get('/remote/sample.bin')).toEqual(bytes);
      expect(remote.channel.write.mock.calls.length).toBeGreaterThan(1);
      expect(progress).toHaveBeenLastCalledWith(bytes.length, bytes.length);
      expect([...remote.files.keys()]).toEqual(['/remote/sample.bin']);
      expect(remote.handles.size).toBe(0);
      expect(await readFile(join(directory, 'sample.bin'))).toEqual(bytes);
      await rm(join(directory, 'sample.bin'));
      await transferFile(
        remote.client,
        request(directory, 'download'),
        new AbortController().signal,
        () => {},
      );
      expect(await readFile(join(directory, 'sample.bin'))).toEqual(bytes);
      expect(await readdir(directory)).toEqual(['sample.bin']);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('refuses existing upload and download destinations without modifying either source', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mterminal-transfer-exists-'));
    const remote = remoteFixture({ '/remote/sample.bin': Buffer.from('remote original') });
    try {
      await writeFile(join(directory, 'sample.bin'), 'local original');
      for (const direction of ['upload', 'download'] as const)
        await expect(
          transferFile(
            remote.client,
            request(directory, direction),
            new AbortController().signal,
            () => {},
          ),
        ).rejects.toMatchObject({ code: 'exists' });
      expect(remote.files.get('/remote/sample.bin')?.toString()).toBe('remote original');
      expect(await readFile(join(directory, 'sample.bin'), 'utf8')).toBe('local original');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('cancels copying and cleans only the owned temporary file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mterminal-transfer-cancel-'));
    const remote = remoteFixture();
    try {
      const bytes = Buffer.alloc(192 * 1024, 1);
      await writeFile(join(directory, 'sample.bin'), bytes);
      const controller = new AbortController();
      await expect(
        transferFile(remote.client, request(directory), controller.signal, (count) => {
          if (count) controller.abort(new FileBrowserError('cancelled'));
        }),
      ).rejects.toMatchObject({ code: 'cancelled', partialPath: null });
      expect(remote.files.size).toBe(0);
      expect(remote.handles.size).toBe(0);
      expect(await readFile(join(directory, 'sample.bin'))).toEqual(bytes);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('publishes empty files and reports an uncertain remote rename without removing the final file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mterminal-transfer-empty-'));
    const remote = remoteFixture();
    try {
      await writeFile(join(directory, 'sample.bin'), '');
      const controller = new AbortController();
      remote.channel.rename.mockImplementation((from, to) => {
        remote.files.set(to, remote.files.get(from)!);
        remote.files.delete(from);
        controller.abort(new FileBrowserError('disconnected'));
      });
      await expect(
        transferFile(remote.client, request(directory), controller.signal, () => {}),
      ).rejects.toMatchObject({ code: 'uncertain' });
      expect(remote.files.get('/remote/sample.bin')).toEqual(Buffer.alloc(0));
      await rm(join(directory, 'sample.bin'));
      await transferFile(
        remote.client,
        request(directory, 'download'),
        new AbortController().signal,
        () => {},
      );
      expect(await readFile(join(directory, 'sample.bin'))).toEqual(Buffer.alloc(0));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('reports a staging path when cancellation cleanup fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mterminal-transfer-cleanup-'));
    const remote = remoteFixture();
    try {
      await writeFile(join(directory, 'sample.bin'), Buffer.alloc(100000));
      remote.channel.unlink.mockImplementation((_path, done) =>
        done(Object.assign(new Error('Denied'), { code: 3 })),
      );
      const controller = new AbortController();
      await expect(
        transferFile(remote.client, request(directory), controller.signal, (count) => {
          if (count) controller.abort(new FileBrowserError('cancelled'));
        }),
      ).rejects.toMatchObject({
        code: 'cancelled',
        partialPath: expect.stringMatching(/^\/remote\/\.mterminal-.*\.part$/),
      });
      expect(remote.files.has('/remote/sample.bin')).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
