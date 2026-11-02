import { describe, expect, it, vi } from 'vitest';
import { sftpRequest } from '../../src/main/files/sftp-request.js';
import { FileBrowserError } from '../../src/main/files/listing.js';

describe('SFTP request deadlines', () => {
  it('times out a stalled request and removes its timer', async () => {
    vi.useFakeTimers();
    try {
      const pending = sftpRequest(new AbortController().signal, () => {}, 30000);
      const rejected = expect(pending).rejects.toMatchObject({ code: 'transfer-timeout' });
      await vi.advanceTimersByTimeAsync(30000);
      await rejected;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it('preserves the cancellation reason and clears deadlines after success or abort', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      await expect(
        sftpRequest<number>(controller.signal, (done) => done(undefined, 42), 30000),
      ).resolves.toBe(42);
      expect(vi.getTimerCount()).toBe(0);
      const pending = sftpRequest(controller.signal, () => {}, 30000);
      const rejected = expect(pending).rejects.toMatchObject({ code: 'cancelled' });
      controller.abort(new FileBrowserError('cancelled'));
      await rejected;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
