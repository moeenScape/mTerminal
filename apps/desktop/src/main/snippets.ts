import type { LocalDatabase } from './storage/database.js';
import { ipcMain, type BrowserWindow } from 'electron';
import { snippetChannels, SNIPPETS_CHANGED, validStartupTarget } from '../shared/snippets.js';
import { validHostId } from '../shared/hosts.js';
import { failureCode } from './failures.js';
import { validateAppInfoRequest } from './security.js';
import type { SshSecretStore } from './storage/secret-store.js';
export function attachSnippets(
  window: BrowserWindow,
  rendererUrl: string,
  secrets: SshSecretStore,
  database: Pick<LocalDatabase, 'listHosts'>,
) {
  for (const channel of Object.values(snippetChannels)) {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      validateAppInfoRequest(event, window.webContents, rendererUrl, []);
      try {
        if (channel === snippetChannels.list && args.length === 0)
          return { ok: true, value: await secrets.listSnippets() };
        if (
          channel === snippetChannels.startup &&
          args.length === 1 &&
          validStartupTarget(args[0])
        ) {
          const exists =
            args[0] === 'local' || database.listHosts().some((host) => host.id === args[0]);
          return { ok: true, value: exists ? await secrets.getStartupSnippet(args[0]) : null };
        }
        let value;
        if (
          channel === snippetChannels.setStartup &&
          args.length === 2 &&
          validStartupTarget(args[0]) &&
          (args[1] === null || validHostId(args[1]))
        ) {
          if (
            args[0] !== 'local' &&
            args[1] !== null &&
            !database.listHosts().some((host) => host.id === args[0])
          )
            throw new Error('Missing startup host.');
          await secrets.setStartupSnippet(args[0], args[1]);
        } else if (
          channel === snippetChannels.save &&
          args.length === 2 &&
          (args[1] === undefined || validHostId(args[1]))
        )
          value = await secrets.saveSnippet(args[0], args[1]);
        else if (channel === snippetChannels.delete && args.length === 1 && validHostId(args[0]))
          await secrets.deleteSnippet(args[0]);
        else throw new Error('Invalid snippet request.');
        if (!window.webContents.isDestroyed()) window.webContents.send(SNIPPETS_CHANGED);
        return { ok: true, value };
      } catch (error) {
        return { ok: false, code: failureCode(error, 'snippet-failed') };
      }
    });
  }
  window.once('closed', () => {
    for (const channel of Object.values(snippetChannels)) ipcMain.removeHandler(channel);
  });
}
