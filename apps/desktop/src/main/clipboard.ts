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
      const [text, options] = args;
      if (
        args.length < 1 ||
        args.length > 2 ||
        (args.length === 2 && (typeof options !== 'object' || options === null))
      )
        return { ok: false, code: 'clipboard-unavailable' };
      if (!validClipboardText(text)) return { ok: false, code: 'clipboard-too-large' };
      if (!text || !window.isFocused()) return { ok: false, code: 'clipboard-unavailable' };
      try {
        await clipboard.writeText(text);
        // Linux terminals also fill the primary selection, pasted with the middle mouse button.
        if ((options as { primary?: unknown } | undefined)?.primary === true)
          await clipboard.selection?.writeText(text);
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
