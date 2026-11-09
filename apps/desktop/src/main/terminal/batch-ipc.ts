import { ipcMain, type BrowserWindow } from 'electron';
import { batchChannels, BATCH_CHANGED } from '../../shared/batch.js';
import { validHostId } from '../../shared/hosts.js';
import { failureCode } from '../failures.js';
import { validateAppInfoRequest } from '../security.js';
import { CommandBatch } from './batch.js';
import type { TerminalRegistry } from './registry.js';
export function attachBatch(
  window: BrowserWindow,
  rendererUrl: string,
  terminals: TerminalRegistry,
) {
  const owner = window.webContents;
  let disposed = false;
  const batch = new CommandBatch(terminals, () => {
    if (!disposed && !owner.isDestroyed()) {
      try {
        owner.send(BATCH_CHANGED);
      } catch {
        /* The renderer can disappear during cleanup. */
      }
    }
  });
  for (const channel of Object.values(batchChannels))
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      validateAppInfoRequest(event, owner, rendererUrl, []);
      try {
        if (channel === batchChannels.targets && !args.length)
          return { ok: true, value: batch.targets() };
        if (channel === batchChannels.state && !args.length)
          return { ok: true, value: batch.state() };
        if (channel === batchChannels.prepare && args.length === 1)
          return { ok: true, value: batch.prepare(args[0]) };
        if (channel === batchChannels.start && args.length === 1 && validHostId(args[0]))
          return { ok: true, value: batch.start(args[0]) };
        if (channel === batchChannels.cancel && args.length === 1 && validHostId(args[0])) {
          batch.cancel(args[0]);
          return { ok: true, value: undefined };
        }
        throw new Error('Invalid batch request.');
      } catch (error) {
        return { ok: false, code: failureCode(error, 'batch-failed') };
      }
    });
  const reset = () => batch.reset();
  owner.on('did-navigate', reset);
  owner.on('render-process-gone', reset);
  window.once('closed', () => {
    disposed = true;
    batch.dispose();
    owner.off('did-navigate', reset);
    owner.off('render-process-gone', reset);
    for (const channel of Object.values(batchChannels)) ipcMain.removeHandler(channel);
  });
  return batch;
}
