import { describe, expect, it, vi } from 'vitest';
import type { TerminalRegistry } from '../../src/main/terminal/registry.js';
import { TransferQueue, validTransferRequest } from '../../src/main/files/transfer-queue.js';
import { FileBrowserError } from '../../src/main/files/listing.js';
import { TransferConflict } from '../../src/main/files/transfer-conflict.js';
import type { TransferConflictPreview } from '../../src/shared/transfers.js';
import { TRANSFER_LIMIT, type TransferRequest } from '../../src/shared/transfers.js';
import { tmpdir } from 'node:os';
const request: TransferRequest = {
  sessionId: '04e9f162-d3cd-4c8f-a70a-2323a1751a9b',
  title: 'Fixture',
  direction: 'upload',
  localDirectory: tmpdir(),
  remoteDirectory: '/remote',
  name: 'file.txt',
};

describe('window-owned transfer queue', () => {
  it('keeps conflicts pending, rejects stale decisions, and skips without copying again', async () => {
    const preview: TransferConflictPreview = {
      token: request.sessionId,
      replaceable: true,
      source: {
        path: '/source',
        kind: 'file',
        size: 1,
        modified: 1,
        permissions: '0600',
        version: 'source',
      },
      destination: {
        path: '/destination',
        kind: 'file',
        size: 2,
        modified: 2,
        permissions: '0600',
        version: 'destination',
      },
    };
    const transferFile = vi.fn(async () => {
      throw new TransferConflict(preview);
    });
    const queue = new TransferQueue(
      {
        onSessionClosed: () => () => {},
        canTransfer: () => true,
        transferFile,
      } as unknown as TerminalRegistry,
      () => {},
      { list: () => [], save: () => {}, forget: () => {} },
    );
    try {
      queue.enqueue(request);
      await vi.waitFor(() => expect(queue.list()[0]?.state).toBe('conflict'));
      const job = queue.list()[0]!;
      expect(() => queue.resolve(job.id, 'stale-token', 'replace')).toThrow('destination-changed');
      queue.resolve(job.id, preview.token, 'skip');
      expect(queue.list()[0]?.state).toBe('skipped');
      expect(transferFile).toHaveBeenCalledTimes(1);
    } finally {
      queue.dispose();
    }
  });
  it('passes only the stored conflict approval when replacement is chosen', async () => {
    const preview: TransferConflictPreview = {
      token: request.sessionId,
      replaceable: true,
      source: {
        path: '/source',
        kind: 'file',
        size: 1,
        modified: 1,
        permissions: '0600',
        version: 'source',
      },
      destination: {
        path: '/destination',
        kind: 'file',
        size: 2,
        modified: 2,
        permissions: '0600',
        version: 'destination',
      },
    };
    const transferFile = vi.fn(
      async (
        _id: string,
        _request: TransferRequest,
        _signal: AbortSignal,
        _progress: (count: number, total: number) => void,
        approval?: TransferConflictPreview,
      ) => {
        if (!approval) throw new TransferConflict(preview);
        return { partialPath: null, backupPath: '/backup' };
      },
    );
    const queue = new TransferQueue(
      {
        onSessionClosed: () => () => {},
        canTransfer: () => true,
        transferFile,
      } as unknown as TerminalRegistry,
      () => {},
      { list: () => [], save: () => {}, forget: () => {} },
    );
    try {
      queue.enqueue(request);
      await vi.waitFor(() => expect(queue.list()[0]?.state).toBe('conflict'));
      const displayed = queue.list()[0]!;
      displayed.conflict!.destination.path = '/tampered';
      queue.resolve(displayed.id, preview.token, 'replace');
      await vi.waitFor(() => expect(queue.list()[0]?.state).toBe('completed'));
      expect(transferFile.mock.calls[1]?.[4]?.destination.path).toBe('/destination');
      expect(queue.list()[0]?.backupPath).toBe('/backup');
    } finally {
      queue.dispose();
    }
  });
  it('validates paths, filenames, directions and session ownership', () => {
    expect(validTransferRequest(request)).toBe(true);
    for (const value of [
      null,
      { ...request, sessionId: 'other' },
      { ...request, name: '../escape' },
      { ...request, remoteDirectory: 'relative' },
      { ...request, localDirectory: '\0' },
      { ...request, direction: 'copy' },
      { ...request, extra: true },
    ])
      expect(validTransferRequest(value)).toBe(false);
    const queue = new TransferQueue(
      { onSessionClosed: () => () => {}, canTransfer: () => false } as unknown as TerminalRegistry,
      () => {},
      { list: () => [], save: () => {}, forget: () => {} },
    );
    expect(() => queue.enqueue(request)).toThrow('disconnected');
    queue.dispose();
  });
  it('runs sequentially, cancels queued jobs, bounds the queue and keeps outcomes inspectable', async () => {
    let complete!: () => void;
    let closed!: (id: string) => void;
    const transferFile = vi.fn(
      (_id: string, _request: TransferRequest, signal: AbortSignal) =>
        new Promise<{ partialPath: null }>((resolve, reject) => {
          complete = () => resolve({ partialPath: null });
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    );
    const queue = new TransferQueue(
      {
        onSessionClosed: (listener: typeof closed) => {
          closed = listener;
          return () => {};
        },
        canTransfer: () => true,
        transferFile,
      } as unknown as TerminalRegistry,
      vi.fn(),
      { list: () => [], save: () => {}, forget: () => {} },
    );
    try {
      queue.enqueue(request);
      queue.enqueue({ ...request, name: 'second.txt' });
      queue.enqueue({ ...request, name: 'cancel.txt' });
      expect(transferFile).toHaveBeenCalledTimes(1);
      queue.cancel(queue.list()[2]!.id);
      complete();
      await vi.waitFor(() => expect(transferFile).toHaveBeenCalledTimes(2));
      expect(queue.list().map((job) => job.state)).toEqual(['completed', 'running', 'cancelled']);
      closed(request.sessionId);
      await vi.waitFor(() => expect(queue.list()[1]?.state).toBe('failed'));
      queue.clearFinished();
      expect(queue.list()).toEqual([]);
      for (let i = 0; i < TRANSFER_LIMIT; i++) queue.enqueue({ ...request, name: `file-${i}` });
      expect(() => queue.enqueue(request)).toThrow('queue-full');
      queue.cancel(queue.list()[0]!.id);
      expect(queue.list()[0]?.state).toBe('cancelling');
    } finally {
      queue.dispose();
    }
  });
  it('cancels the active request through its signal', async () => {
    const queue = new TransferQueue(
      {
        onSessionClosed: () => () => {},
        canTransfer: () => true,
        transferFile: (_id: string, _request: TransferRequest, signal: AbortSignal) =>
          new Promise((_resolve, reject) =>
            signal.addEventListener('abort', () => reject(new FileBrowserError('cancelled')), {
              once: true,
            }),
          ),
      } as unknown as TerminalRegistry,
      () => {},
      { list: () => [], save: () => {}, forget: () => {} },
    );
    queue.enqueue(request);
    queue.cancel(queue.list()[0]!.id);
    await vi.waitFor(() => expect(queue.list()[0]?.state).toBe('cancelled'));
    queue.dispose();
  });
});
