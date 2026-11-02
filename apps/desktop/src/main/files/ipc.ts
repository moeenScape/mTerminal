import { ipcMain, type BrowserWindow } from 'electron';
import {
  FILES_LIST,
  FILES_MUTATE,
  type FileMutationResult,
  type FileListResult,
} from '../../shared/files.js';
import { mutateLocalDirectory, validMutationRequest } from './operations.js';
import { validateAppInfoRequest } from '../security.js';
import type { TerminalRegistry } from '../terminal/registry.js';
import {
  transferChannels,
  TRANSFERS_CHANGED,
  type TransferResponse,
  type TransferJob,
} from '../../shared/transfers.js';
import { validTerminalId } from '../../shared/terminal.js';
import { TransferQueue, validTransferRequest } from './transfer-queue.js';
import {
  fileErrorCode,
  FileBrowserError,
  listLocalDirectory,
  validFileRequest,
} from './listing.js';

export function attachFiles(
  window: BrowserWindow,
  rendererUrl: string,
  terminals: TerminalRegistry,
): void {
  let pending = 0;
  let mutating = false;
  let disposed = false;
  const transfers = new TransferQueue(terminals, () => {
    if (!disposed && !window.webContents.isDestroyed()) window.webContents.send(TRANSFERS_CHANGED);
  });
  for (const channel of Object.values(transferChannels)) {
    ipcMain.handle(
      channel,
      async (event, ...args: unknown[]): Promise<TransferResponse<TransferJob[] | undefined>> => {
        validateAppInfoRequest(event, window.webContents, rendererUrl, []);
        if (disposed) return { ok: false, code: 'disconnected' };
        try {
          if (channel === transferChannels.list && !args.length)
            return { ok: true, value: transfers.list() };
          if (channel === transferChannels.clear && !args.length) transfers.clearFinished();
          else if (
            channel === transferChannels.resolve &&
            args.length === 3 &&
            validTerminalId(args[0]) &&
            validTerminalId(args[1]) &&
            (args[2] === 'replace' || args[2] === 'skip')
          ) {
            if (mutating) throw new FileBrowserError('busy');
            transfers.resolve(args[0], args[1], args[2]);
          } else if (
            channel === transferChannels.enqueue &&
            args.length === 1 &&
            validTransferRequest(args[0])
          ) {
            if (mutating) throw new FileBrowserError('busy');
            transfers.enqueue(args[0]);
          } else if (
            channel === transferChannels.cancel &&
            args.length === 1 &&
            validTerminalId(args[0])
          )
            transfers.cancel(args[0]);
          else throw new Error('Invalid transfer request.');
          return { ok: true, value: undefined };
        } catch (error) {
          return { ok: false, code: fileErrorCode(error) };
        }
      },
    );
  }
  ipcMain.handle(FILES_LIST, async (event, ...args: unknown[]): Promise<FileListResult> => {
    validateAppInfoRequest(event, window.webContents, rendererUrl, []);
    if (args.length !== 1 || !validFileRequest(args[0]))
      throw new Error('Invalid file browser request.');
    if (disposed) return { ok: false, code: 'disconnected' };
    if (pending >= 4 || mutating) return { ok: false, code: 'busy' };
    pending++;
    try {
      const request = args[0];
      const value =
        request.side === 'local'
          ? await listLocalDirectory(request.path)
          : await terminals.listDirectory(request.sessionId, request.path);
      if (disposed) throw new FileBrowserError('disconnected');
      return { ok: true, value };
    } catch (error) {
      return { ok: false, code: fileErrorCode(error) };
    } finally {
      pending--;
    }
  });
  ipcMain.handle(FILES_MUTATE, async (event, ...args: unknown[]): Promise<FileMutationResult> => {
    validateAppInfoRequest(event, window.webContents, rendererUrl, []);
    if (args.length !== 1 || !validMutationRequest(args[0]))
      throw new Error('Invalid file operation request.');
    if (disposed) return { ok: false, code: 'disconnected' };
    if (pending || mutating || transfers.running) return { ok: false, code: 'busy' };
    mutating = true;
    try {
      const request = args[0];
      if (request.side === 'local') await mutateLocalDirectory(request.path, request.operation);
      else await terminals.mutateDirectory(request.sessionId, request.path, request.operation);
      return { ok: true };
    } catch (error) {
      return { ok: false, code: fileErrorCode(error) };
    } finally {
      mutating = false;
    }
  });
  window.once('closed', () => {
    disposed = true;
    transfers.dispose();
    ipcMain.removeHandler(FILES_LIST);
    ipcMain.removeHandler(FILES_MUTATE);
    for (const channel of Object.values(transferChannels)) ipcMain.removeHandler(channel);
  });
  // A reload starts a fresh UI; outstanding writes must not continue invisibly.
  const reset = () => {
    for (const job of transfers.list()) transfers.cancel(job.id);
    transfers.clearFinished();
  };
  window.webContents.on('did-navigate', reset);
  window.webContents.on('render-process-gone', reset);
}
