import { ipcMain, type BrowserWindow } from 'electron';
import { validHostId } from '../shared/hosts.js';
import { proxyChannels, type ProxySummary } from '../shared/proxies.js';
import { validateAppInfoRequest } from './security.js';
import type { LocalDatabase } from './storage/database.js';
import type { SshSecretStore } from './storage/secret-store.js';

export type ProxyResponse<T> = { ok: true; value: T } | { ok: false; message: string };

/** Saved proxies live in SQLite; their passwords live only in the vault. */
export function attachProxies(
  window: BrowserWindow,
  rendererUrl: string,
  database: LocalDatabase,
  secrets: SshSecretStore,
) {
  const owner = window.webContents;
  for (const channel of Object.values(proxyChannels))
    ipcMain.handle(channel, async (event, ...args: unknown[]): Promise<ProxyResponse<unknown>> => {
      validateAppInfoRequest(event, owner, rendererUrl, []);
      try {
        if (channel === proxyChannels.list && !args.length) {
          const proxies: ProxySummary[] = [];
          for (const proxy of database.listProxies()) {
            const saved = await secrets
              .passwordStatus(proxy.id)
              .then((status) => status.saved)
              .catch(() => false);
            proxies.push({ ...proxy, passwordSaved: saved });
          }
          return { ok: true, value: proxies };
        }
        if (channel === proxyChannels.save && args.length >= 1 && args.length <= 3) {
          const [draft, password, id] = args;
          if (
            (password !== undefined && password !== null && typeof password !== 'string') ||
            (typeof password === 'string' && password.length > 255) ||
            (id !== undefined && !validHostId(id))
          )
            throw new Error('Invalid proxy request.');
          const saved = database.saveProxy(draft, id);
          try {
            if (typeof password === 'string' && password)
              await secrets.savePassword(saved.id, password);
            else if (password === null) await secrets.deletePassword(saved.id);
          } catch {
            return {
              ok: false,
              message:
                'The proxy was saved, but its password was not. Set up or unlock the vault, then edit the proxy and enter the password again.',
            };
          }
          return { ok: true, value: saved };
        }
        if (channel === proxyChannels.delete && args.length === 1 && validHostId(args[0])) {
          database.deleteProxy(args[0]);
          await secrets.deletePassword(args[0]).catch(() => {});
          return { ok: true, value: undefined };
        }
        throw new Error('Invalid proxy request.');
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        return {
          ok: false,
          message: /^(Enter|Choose|Use|Too many|Proxy no longer)/.test(message)
            ? message
            : 'Proxy operation failed. Check the fields and local storage, then retry.',
        };
      }
    });
  window.once('closed', () => {
    for (const channel of Object.values(proxyChannels)) ipcMain.removeHandler(channel);
  });
}
