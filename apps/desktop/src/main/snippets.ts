import { ipcMain, type BrowserWindow } from 'electron';
import { snippetChannels, SNIPPETS_CHANGED } from '../shared/snippets.js';
import { validHostId } from '../shared/hosts.js';
import { failureCode } from './failures.js';
import { validateAppInfoRequest } from './security.js';
import type { SshSecretStore } from './storage/secret-store.js';
export function attachSnippets(
  window: BrowserWindow,
  rendererUrl: string,
  secrets: SshSecretStore,
) {
  for (const channel of Object.values(snippetChannels)) {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      validateAppInfoRequest(event, window.webContents, rendererUrl, []);
      try {
        if (channel === snippetChannels.list && args.length === 0)
          return { ok: true, value: await secrets.listSnippets() };
        let value;
        if (
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
