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

const outputDirectory = dirname(fileURLToPath(import.meta.url));

export async function createMainWindow(
  diagnostics: DiagnosticLog,
  database: LocalDatabase,
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

  for (const channel of Object.values(hostChannels)) {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      validateAppInfoRequest(event, window.webContents, rendererUrl, []);
      try {
        if (channel === hostChannels.groups && args.length === 0) return database.listHostGroups();
        if (channel === hostChannels.saveGroup && args.length === 1)
          return database.saveHostGroup(args[0]);
        if (channel === hostChannels.deleteGroup && args.length === 1)
          return database.deleteHostGroup(args[0]);
        if (channel === hostChannels.list && args.length === 0) return database.listHosts();
        if (
          channel === hostChannels.save &&
          args.length === 2 &&
          (args[1] === undefined || validHostId(args[1]))
        )
          return database.saveHost(args[0], args[1]);
        if (channel === hostChannels.delete && args.length === 1)
          return database.deleteHost(args[0]);
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

  attachClipboard(window, rendererUrl, diagnostics);
  const terminals = attachTerminal(
    window,
    rendererUrl,
    () => store.preferences.defaultShell,
    diagnostics,
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
