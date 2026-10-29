import { hostChannels, validHostId } from '../shared/hosts.js';
import type { LocalDatabase } from './storage/database.js';
import { attachClipboard } from './clipboard.js';
import { validateShellOverride } from './terminal/shells.js';
import { attachTerminal } from './terminal/ipc.js';
import { AppFailure, failureCode } from './failures.js';
import type { DiagnosticLog } from './diagnostics.js';
import { failureMessages, type PreferenceSaveResult } from '../shared/failures.js';
import { PreferencesStore } from './preferences.js';
import { PREFERENCES_GET, PREFERENCES_SAVE, validatePreferences } from '../shared/preferences.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, session, dialog } from 'electron';
import { APP_INFO_CHANNEL, type AppInfo } from '../shared/app-info.js';
import { allowRendererReload, getRendererUrl, validateAppInfoRequest } from './security.js';
import {
  vaultChannels,
  vaultEvents,
  type VaultResponse,
  type VaultState,
} from '../shared/vault.js';
import { SshSecretStore } from './storage/secret-store.js';
import { readFile } from 'node:fs/promises';
import { utils } from './ssh2-module.js';
import { formatSshPublicKey } from '../shared/ssh.js';
import { backupChannels } from '../shared/backup.js';
import { chmod, rename, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const outputDirectory = dirname(fileURLToPath(import.meta.url));

export async function createMainWindow(
  diagnostics: DiagnosticLog,
  database: LocalDatabase,
  secrets: SshSecretStore,
): Promise<BrowserWindow> {
  const rendererUrl = getRendererUrl(
    join(outputDirectory, '../renderer/index.html'),
    process.env.ELECTRON_RENDERER_URL,
    app.isPackaged,
  );

  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);

  const store = new PreferencesStore(join(app.getPath('userData'), 'preferences.json'));
  try {
    await store.load();
  } catch (error) {
    throw new AppFailure(failureCode(error, 'preferences-invalid'));
  }
  const saved = store.preferences.rememberWindow
    ? store.window
    : { width: 1200, height: 800, maximized: false };
  const window = new BrowserWindow({
    title: 'mTerminal',
    width: saved.width,
    height: saved.height,
    minWidth: 760,
    minHeight: 520,
    show: false,
    backgroundColor: '#12141c',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(outputDirectory, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
    },
  });

  // The vault stays unlocked until the app closes or the user locks it.
  for (const channel of Object.values(hostChannels)) {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      validateAppInfoRequest(event, window.webContents, rendererUrl, []);
      try {
        if (channel === hostChannels.groups && args.length === 0) return database.listHostGroups();
        if (channel === hostChannels.saveGroup && args.length === 1)
          return database.saveHostGroup(args[0]);
        if (channel === hostChannels.deleteGroup && args.length === 1)
          return database.deleteHostGroup(args[0]);
        if (channel === hostChannels.identities && args.length === 0)
          return database.listSshIdentities();
        if (
          channel === hostChannels.saveIdentity &&
          args.length === 2 &&
          (args[1] === undefined || validHostId(args[1]))
        )
          return database.saveSshIdentity(args[0], args[1]);
        if (channel === hostChannels.deleteIdentity && args.length === 1) {
          if (
            validHostId(args[0]) &&
            database.listSshIdentities().some((item) => item.id === args[0])
          )
            await secrets.deletePassword(args[0]);
          if (
            validHostId(args[0]) &&
            database.listSshIdentities().some((item) => item.id === args[0])
          )
            await secrets.deletePrivateKey(args[0]);
          return database.deleteSshIdentity(args[0]);
        }
        if (channel === hostChannels.list && args.length === 0) return database.listHosts();
        if (
          channel === hostChannels.save &&
          args.length === 2 &&
          (args[1] === undefined || validHostId(args[1]))
        )
          return database.saveHost(args[0], args[1]);
        if (channel === hostChannels.delete && args.length === 1) {
          const host = database.listHosts().find((item) => item.id === args[0]);
          // The host's saved password goes with it.
          if (host) await secrets.deletePassword(host.id).catch(() => {});
          return database.deleteHost(args[0]);
        }
        throw new Error('Invalid request.');
      } catch {
        diagnostics.record('host-operation-failed');
        throw new Error('Host operation failed. Check the fields and local storage, then retry.');
      }
    });
  }
  window.once('closed', () => {
    for (const channel of Object.values(hostChannels)) ipcMain.removeHandler(channel);
  });

  ipcMain.handle(backupChannels.export, async (event) => {
    validateAppInfoRequest(event, window.webContents, rendererUrl, []);
    const selection = await dialog.showSaveDialog(window, {
      title: 'Export mTerminal workspace',
      defaultPath: 'mterminal-workspace.json',
      filters: [{ name: 'mTerminal backup', extensions: ['json'] }],
    });
    if (selection.canceled || !selection.filePath) return false;
    const temporary = `${selection.filePath}.tmp-${randomUUID()}`;
    try {
      await writeFile(temporary, `${JSON.stringify(database.exportWorkspace(), null, 2)}\n`, {
        mode: 0o600,
        flag: 'wx',
      });
      await chmod(temporary, 0o600);
      await rename(temporary, selection.filePath);
      return true;
    } finally {
      await rm(temporary, { force: true });
    }
  });
  ipcMain.handle(backupChannels.import, async (event) => {
    validateAppInfoRequest(event, window.webContents, rendererUrl, []);
    const selection = await dialog.showOpenDialog(window, {
      title: 'Import mTerminal workspace',
      properties: ['openFile'],
      filters: [{ name: 'mTerminal backup', extensions: ['json'] }],
    });
    if (selection.canceled || !selection.filePaths[0]) return undefined;
    const path = selection.filePaths[0];
    const info = await stat(path);
    if (!info.isFile() || info.size > 5 * 1024 * 1024) throw new Error('Backup file is too large.');
    const records = JSON.parse((await readFile(path, 'utf8')) as string) as unknown;
    const confirmation = await dialog.showMessageBox(window, {
      type: 'warning',
      buttons: ['Import records', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Import workspace records',
      message: 'Import hosts, groups, identities, and trusted host keys?',
      detail:
        'Records are merged without replacing existing entries. Conflicts abort the entire import. Saved passwords and private keys are not included.',
    });
    if (confirmation.response !== 0) return undefined;
    return database.importWorkspace(records);
  });
  window.once('closed', () => {
    ipcMain.removeHandler(backupChannels.export);
    ipcMain.removeHandler(backupChannels.import);
  });

  for (const channel of Object.values(vaultChannels)) {
    ipcMain.handle(channel, async (event, ...args: unknown[]): Promise<VaultResponse<unknown>> => {
      validateAppInfoRequest(event, window.webContents, rendererUrl, []);
      try {
        if (channel === vaultChannels.state && args.length === 0)
          return { ok: true, value: (await secrets.vaultStatus()) as VaultState };
        if (channel === vaultChannels.setup && args.length === 1 && typeof args[0] === 'string') {
          await secrets.setupVault(args[0]);
          return { ok: true, value: undefined };
        }
        if (channel === vaultChannels.unlock && args.length === 1 && typeof args[0] === 'string') {
          await secrets.unlockVault(args[0]);
          return { ok: true, value: undefined };
        }
        if (channel === vaultChannels.lock && args.length === 0) {
          await secrets.lockVault();
          if (!window.webContents.isDestroyed()) window.webContents.send(vaultEvents.locked);
          return { ok: true, value: undefined };
        }
        if (channel === vaultChannels.reset && args.length === 0) {
          const confirmation = await dialog.showMessageBox(window, {
            type: 'warning',
            buttons: ['Reset vault', 'Cancel'],
            defaultId: 1,
            cancelId: 1,
            title: 'Reset local vault',
            message: 'Create a new vault without the current passphrase?',
            detail:
              'Saved passwords and keys will no longer be available. Their encrypted files will be preserved in a recovery folder under the vault directory. Host and identity records will remain.',
          });
          if (confirmation.response !== 0) return { ok: true, value: false };
          await secrets.resetVault();
          return { ok: true, value: true };
        }
        const [identityId, value] = args;
        const isIdentity =
          validHostId(identityId) &&
          database.listSshIdentities().some((item) => item.id === identityId);
        // Saved passwords can also belong to a host directly; keys are identity-only.
        const isHost =
          validHostId(identityId) && database.listHosts().some((item) => item.id === identityId);
        const passwordChannel = [vaultChannels.status, vaultChannels.save, vaultChannels.delete];
        if (!isIdentity && !(isHost && (passwordChannel as readonly string[]).includes(channel)))
          throw new AppFailure('vault-secret-missing');
        if (channel === vaultChannels.status && args.length === 1)
          return { ok: true, value: await secrets.passwordStatus(identityId) };
        if (
          channel === vaultChannels.save &&
          args.length === 2 &&
          typeof value === 'string' &&
          value.length > 0 &&
          value.length <= 4096
        ) {
          await secrets.savePassword(identityId, value);
          return { ok: true, value: undefined };
        }
        if (channel === vaultChannels.delete && args.length === 1) {
          await secrets.deletePassword(identityId);
          return { ok: true, value: undefined };
        }
        if (channel === vaultChannels.keyStatus && args.length === 1)
          return { ok: true, value: await secrets.privateKeyStatus(identityId) };
        if (channel === vaultChannels.keyDelete && args.length === 1) {
          await secrets.deletePrivateKey(identityId);
          return { ok: true, value: undefined };
        }
        if (
          (channel === vaultChannels.keyImport || channel === vaultChannels.keyGenerate) &&
          args.length === 2 &&
          typeof value === 'string' &&
          value.length <= 4096
        ) {
          let privateKey: string | undefined;
          if (channel === vaultChannels.keyImport) {
            const selection = await dialog.showOpenDialog(window, {
              title: 'Import SSH private key',
              properties: ['openFile'],
            });
            if (selection.canceled || !selection.filePaths[0]) return { ok: true, value: '' };
            const info = await readFile(selection.filePaths[0]);
            if (info.length > 256 * 1024) throw new Error('Private key is too large.');
            privateKey = info.toString('utf8');
            const parsed = utils.parseKey(privateKey, value);
            if (parsed instanceof Error || Array.isArray(parsed) || !parsed.isPrivateKey())
              throw new AppFailure('ssh-key-invalid');
          }
          if (channel === vaultChannels.keyImport)
            await secrets.savePrivateKey(identityId, privateKey!, value);
          else if (channel === vaultChannels.keyGenerate)
            return { ok: true, value: await secrets.generatePrivateKey(identityId, value) };
          const parsed = utils.parseKey(privateKey!, value);
          if (parsed instanceof Error || Array.isArray(parsed))
            throw new Error('Invalid private key.');
          return {
            ok: true,
            value: formatSshPublicKey(parsed.type, parsed.getPublicSSH(), parsed.comment),
          };
        }
        throw new Error('Invalid vault request.');
      } catch (error) {
        return { ok: false, code: failureCode(error, 'vault-unavailable') };
      }
    });
  }
  window.once('closed', () => {
    void secrets.lockVault();
    for (const channel of Object.values(vaultChannels)) ipcMain.removeHandler(channel);
  });

  attachClipboard(window, rendererUrl, diagnostics);
  const terminals = attachTerminal(
    window,
    rendererUrl,
    () => store.preferences.defaultShell,
    diagnostics,
    database,
    secrets,
    () => store.preferences.recordHistory,
  );
  window.webContents.on('render-process-gone', () => {
    diagnostics.record('renderer-crashed', 'renderer-crashed');
    dialog.showErrorBox('Interface stopped', failureMessages['renderer-crashed']);
  });
  window.on('unresponsive', () => {
    diagnostics.record('renderer-unresponsive');
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-frame-navigate', (event) => {
    if (!allowRendererReload(event.url, event.isMainFrame, rendererUrl)) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());

  ipcMain.handle(APP_INFO_CHANNEL, (event, ...args: unknown[]): AppInfo => {
    validateAppInfoRequest(event, window.webContents, rendererUrl, args);
    return { name: app.getName(), version: app.getVersion(), platform: process.platform };
  });

  ipcMain.handle(PREFERENCES_GET, (event, ...args: unknown[]) => {
    validateAppInfoRequest(event, window.webContents, rendererUrl, args);
    return store.preferences;
  });
  ipcMain.handle(
    PREFERENCES_SAVE,
    async (event, ...args: unknown[]): Promise<PreferenceSaveResult> => {
      validateAppInfoRequest(event, window.webContents, rendererUrl, []);
      if (args.length !== 1) throw new Error('Invalid preferences request.');
      const preferences = validatePreferences(args[0]);
      try {
        await validateShellOverride(preferences.defaultShell);
        await store.save(preferences);
        return { ok: true, preferences: store.preferences };
      } catch (error) {
        const code = failureCode(error, 'preferences-save');
        diagnostics.record('preferences-save-failed', code);
        return { ok: false, code };
      }
    },
  );
  window.once('ready-to-show', () => {
    if (saved.maximized) window.maximize();
    window.show();
  });
  let closing = false;
  let confirmed = false;
  let confirming = false;
  window.on('close', (event) => {
    if (closing) return;
    if (!confirmed && terminals.count > 0) {
      event.preventDefault();
      if (confirming) return;
      confirming = true;
      void dialog
        .showMessageBox(window, {
          type: 'warning',
          buttons: ['Cancel', 'Close terminals'],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
          message: `Close ${terminals.count} active terminal session${terminals.count === 1 ? '' : 's'}?`,
          detail: 'Running commands may be interrupted and terminal output will be discarded.',
        })
        .then(({ response }) => {
          confirming = false;
          if (response === 1 && !window.isDestroyed()) {
            confirmed = true;
            terminals.suspend(true);
            window.close();
          }
        })
        .catch(() => {
          confirming = false;
        });
      return;
    }
    if (!store.preferences.rememberWindow) return;
    event.preventDefault();
    const bounds = window.getNormalBounds();
    terminals.suspend(true);
    closing = true;
    void store
      .save(store.preferences, {
        width: bounds.width,
        height: bounds.height,
        maximized: window.isMaximized(),
      })
      .then(() => window.close())
      .catch((error: unknown) => {
        const code = failureCode(error, 'preferences-save');
        diagnostics.record('window-state-save-failed', code);
        closing = false;
        confirmed = false;
        terminals.suspend(false);
        // Keep the window open so a failed write cannot silently discard the saved state.
        dialog.showErrorBox(
          'Unable to save window state',
          failureMessages[code] +
            ' You can disable Remember window size in Settings to close without saving it.',
        );
      });
  });
  window.once('closed', () => {
    for (const channel of [APP_INFO_CHANNEL, PREFERENCES_GET, PREFERENCES_SAVE])
      ipcMain.removeHandler(channel);
  });

  try {
    await window.loadURL(rendererUrl);
  } catch (error) {
    window.destroy();
    throw new AppFailure(failureCode(error, 'renderer-load'));
  }

  return window;
}
