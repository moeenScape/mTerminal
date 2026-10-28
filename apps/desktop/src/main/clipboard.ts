import { clipboard, ipcMain, type BrowserWindow } from 'electron';
import {
  clipboardChannels,
  validClipboardText,
  type ClipboardReadResult,
  type ClipboardWriteResult,
} from '../shared/clipboard.js';
import { validateAppInfoRequest } from './security.js';
import type { DiagnosticLog } from './diagnostics.js';

export function attachClipboard(
  window: BrowserWindow,
  rendererUrl: string,
  diagnostics: DiagnosticLog,
): void {
  ipcMain.handle(
    clipboardChannels.read,
    async (event, ...args: unknown[]): Promise<ClipboardReadResult> => {
      validateAppInfoRequest(event, window.webContents, rendererUrl, args);
      try {
        if (!window.isFocused()) return { ok: false, code: 'clipboard-unavailable' };
        const text = await clipboard.readText();
        validateAppInfoRequest(event, window.webContents, rendererUrl, []);
        if (!window.isFocused() || window.webContents.isDestroyed())
          return { ok: false, code: 'clipboard-unavailable' };
        return validClipboardText(text)
          ? { ok: true, text }
          : { ok: false, code: 'clipboard-too-large' };
      } catch {
        diagnostics.record('clipboard-failed', 'clipboard-unavailable');
        return { ok: false, code: 'clipboard-unavailable' };
      }
    },
  );
  ipcMain.handle(
    clipboardChannels.write,
    async (event, ...args: unknown[]): Promise<ClipboardWriteResult> => {
      validateAppInfoRequest(event, window.webContents, rendererUrl, []);
      if (args.length !== 1 || !validClipboardText(args[0]))
        return { ok: false, code: 'clipboard-too-large' };
      if (!args[0] || !window.isFocused()) return { ok: false, code: 'clipboard-unavailable' };
      try {
        await clipboard.writeText(args[0]);
        return { ok: true };
      } catch {
        diagnostics.record('clipboard-failed', 'clipboard-unavailable');
        return { ok: false, code: 'clipboard-unavailable' };
      }
    },
  );
  window.once('closed', () => {
    ipcMain.removeHandler(clipboardChannels.read);
    ipcMain.removeHandler(clipboardChannels.write);
  });
}
