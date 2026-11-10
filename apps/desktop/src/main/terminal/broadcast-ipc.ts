import { ipcMain, type BrowserWindow } from 'electron';
import {
  broadcastChannels,
  BROADCAST_CHANGED,
  isBroadcastStopShortcut,
} from '../../shared/broadcast.js';
import { validHostId } from '../../shared/hosts.js';
import { failureCode } from '../failures.js';
import { validateAppInfoRequest } from '../security.js';
import { InputBroadcast } from './broadcast.js';
import type { TerminalRegistry } from './registry.js';
export function attachBroadcast(
  window: BrowserWindow,
  rendererUrl: string,
  terminals: TerminalRegistry,
) {
  const owner = window.webContents;
  let disposed = false;
  const broadcast = new InputBroadcast(terminals, () => {
    if (!disposed && !owner.isDestroyed()) {
      try {
        owner.send(BROADCAST_CHANGED);
      } catch {
        /* The renderer may already be gone. */
      }
    }
  });
  for (const channel of Object.values(broadcastChannels))
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      validateAppInfoRequest(event, owner, rendererUrl, []);
      try {
        if (channel === broadcastChannels.targets && !args.length)
          return { ok: true, value: broadcast.targets() };
        if (channel === broadcastChannels.state && !args.length)
          return { ok: true, value: broadcast.state() };
        if (channel === broadcastChannels.stop && !args.length) {
          broadcast.stop();
          return { ok: true, value: undefined };
        }
        if (!window.isFocused()) {
          broadcast.stop('Broadcast stopped when the window lost focus.');
          throw new Error('Window is not focused.');
        }
        if (channel === broadcastChannels.start && args.length === 1)
          return { ok: true, value: broadcast.start(args[0]) };
        if (channel === broadcastChannels.send && args.length === 2 && validHostId(args[0])) {
          broadcast.send(args[0], args[1]);
          return { ok: true, value: undefined };
        }
        throw new Error('Invalid broadcast request.');
      } catch (error) {
        return { ok: false, code: failureCode(error, 'broadcast-failed') };
      }
    });
  const reset = () => broadcast.stop('Broadcast stopped because the interface changed.');
  const blur = () => {
    if (broadcast.state().mode) broadcast.stop('Broadcast stopped when the window lost focus.');
  };
  const key = (event: Electron.Event, input: Electron.Input) => {
    if (
      input.type === 'keyDown' &&
      broadcast.state().mode &&
      isBroadcastStopShortcut({
        key: input.key,
        ctrlKey: input.control,
        metaKey: input.meta,
        shiftKey: input.shift,
        altKey: input.alt,
      })
    ) {
      event.preventDefault();
      broadcast.stop('Broadcast stopped by keyboard shortcut.');
    }
  };
  window.on('blur', blur);
  owner.on('did-navigate', reset);
  owner.on('render-process-gone', reset);
  owner.on('before-input-event', key);
  window.once('closed', () => {
    disposed = true;
    broadcast.dispose();
    window.off('blur', blur);
    owner.off('did-navigate', reset);
    owner.off('render-process-gone', reset);
    owner.off('before-input-event', key);
    for (const channel of Object.values(broadcastChannels)) ipcMain.removeHandler(channel);
  });
  return broadcast;
}
