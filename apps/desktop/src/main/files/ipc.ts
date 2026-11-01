import { ipcMain, type BrowserWindow } from 'electron';
import { FILES_LIST, type FileListResult } from '../../shared/files.js';
import { validateAppInfoRequest } from '../security.js';
import type { TerminalRegistry } from '../terminal/registry.js';
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
  let disposed = false;
  ipcMain.handle(FILES_LIST, async (event, ...args: unknown[]): Promise<FileListResult> => {
    validateAppInfoRequest(event, window.webContents, rendererUrl, []);
    if (args.length !== 1 || !validFileRequest(args[0]))
      throw new Error('Invalid file browser request.');
    if (disposed) return { ok: false, code: 'disconnected' };
    if (pending >= 4) return { ok: false, code: 'busy' };
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
  window.once('closed', () => {
    disposed = true;
    ipcMain.removeHandler(FILES_LIST);
  });
}
