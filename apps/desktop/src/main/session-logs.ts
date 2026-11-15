import { ipcMain, type BrowserWindow } from 'electron';
import { sessionLogChannels as channels, SESSION_LOGS_CHANGED } from '../shared/session-logs.js';
import { validHostId } from '../shared/hosts.js';
import { validateAppInfoRequest } from './security.js';
import { failureCode } from './failures.js';
import { SessionLogRecorder } from './terminal/session-logs.js';
import type { TerminalRegistry } from './terminal/registry.js';
import type { SshSecretStore } from './storage/secret-store.js';
export function attachSessionLogs(
  window: BrowserWindow,
  url: string,
  terminals: TerminalRegistry,
  secrets: SshSecretStore,
) {
  const owner = window.webContents;
  let disposed = false;
  const changed = () => {
    if (!disposed && !owner.isDestroyed()) {
      try {
        owner.send(SESSION_LOGS_CHANGED);
      } catch {
        /* Renderer shutdown can race a checkpoint. */
      }
    }
  };
  const recorder = new SessionLogRecorder(terminals, secrets, changed);
  for (const channel of Object.values(channels))
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      validateAppInfoRequest(event, owner, url, []);
      try {
        if (channel === channels.state && !args.length)
          return { ok: true, value: recorder.state() };
        if (
          channel === channels.start &&
          args.length === 2 &&
          typeof args[0] === 'string' &&
          typeof args[1] === 'string'
        ) {
          await recorder.start(args[0], args[1]);
          return { ok: true, value: undefined };
        }
        if (channel === channels.stop && !args.length) {
          await recorder.stop();
          return { ok: true, value: undefined };
        }
        if (channel === channels.list && !args.length)
          return {
            ok: true,
            value: (await secrets.listSessionLogs()).map((log) => ({
              id: log.id,
              sessionId: log.sessionId,
              title: log.title,
              createdAt: log.createdAt,
              updatedAt: log.updatedAt,
              reason: log.reason,
              characters: log.text.length,
            })),
          };
        if (args.length < 1 || !validHostId(args[0])) throw new Error('Invalid log request.');
        const id = args[0];
        if (channel === channels.read && args.length === 1) {
          const log = (await secrets.listSessionLogs()).find((log) => log.id === id);
          if (!log) throw new Error('Log missing.');
          return { ok: true, value: log };
        }
        recorder.assertEditable(id);
        if (channel === channels.annotate && args.length === 2)
          await secrets.annotateSessionLog(id, args[1]);
        else if (channel === channels.delete && args.length === 1)
          await secrets.deleteSessionLog(id);
        else throw new Error('Invalid log request.');
        changed();
        return { ok: true, value: undefined };
      } catch (error) {
        return { ok: false, code: failureCode(error, 'session-log-failed') };
      }
    });
  const reset = () => {
    void recorder.stop('closed').catch(() => {});
  };
  owner.on('did-navigate', reset);
  owner.on('render-process-gone', reset);
  window.once('closed', () => {
    disposed = true;
    owner.off('did-navigate', reset);
    owner.off('render-process-gone', reset);
    for (const channel of Object.values(channels)) ipcMain.removeHandler(channel);
    void recorder.dispose().catch(() => {});
  });
  return recorder;
}
