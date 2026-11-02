import { FileBrowserError } from './listing.js';

export function sftpRequest<T>(
  signal: AbortSignal,
  invoke: (done: (error: Error | undefined, value: T) => void) => void,
  timeout?: number,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      cleanup();
      reject(
        signal.reason instanceof FileBrowserError
          ? signal.reason
          : new FileBrowserError('disconnected'),
      );
    };
    const timer =
      timeout === undefined
        ? undefined
        : setTimeout(() => {
            cleanup();
            reject(new FileBrowserError('transfer-timeout'));
          }, timeout);
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    try {
      invoke((error, value) => {
        cleanup();
        if (error) reject(error);
        else resolve(value);
      });
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
