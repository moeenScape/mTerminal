import { describe, expect, it, vi } from 'vitest';
import type { TerminalRegistry } from '../../src/main/terminal/registry.js';
import { TransferQueue, validTransferRequest } from '../../src/main/files/transfer-queue.js';
import { FileBrowserError } from '../../src/main/files/listing.js';
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
    );
    queue.enqueue(request);
    queue.cancel(queue.list()[0]!.id);
    await vi.waitFor(() => expect(queue.list()[0]?.state).toBe('cancelled'));
    queue.dispose();
  });
});
