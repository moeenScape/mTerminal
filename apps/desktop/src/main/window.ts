import { PreferencesStore } from './preferences.js';
import { PREFERENCES_GET, PREFERENCES_SAVE, validatePreferences } from '../shared/preferences.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, session, dialog } from 'electron';
import { APP_INFO_CHANNEL, type AppInfo } from '../shared/app-info.js';
import { getRendererUrl, validateAppInfoRequest } from './security.js';

const outputDirectory = dirname(fileURLToPath(import.meta.url));

export async function createMainWindow(): Promise<BrowserWindow> {
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
  await store.load();
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

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-frame-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());

  ipcMain.handle(APP_INFO_CHANNEL, (event, ...args: unknown[]): AppInfo => {
    validateAppInfoRequest(event, window.webContents, rendererUrl, args);
    return { name: app.getName(), version: app.getVersion(), platform: process.platform };
  });

  ipcMain.handle(PREFERENCES_GET, (event, ...args: unknown[]) => {
    validateAppInfoRequest(event, window.webContents, rendererUrl, args);
    return store.preferences;
  });
  ipcMain.handle(PREFERENCES_SAVE, async (event, ...args: unknown[]) => {
    validateAppInfoRequest(event, window.webContents, rendererUrl, []);
    if (args.length !== 1) throw new Error('Invalid preferences request.');
    const preferences = validatePreferences(args[0]);
    await store.save(preferences);
    return store.preferences;
  });
  window.once('ready-to-show', () => {
    if (saved.maximized) window.maximize();
    window.show();
  });
  let closing = false;
  window.on('close', (event) => {
    if (closing || !store.preferences.rememberWindow) return;
    event.preventDefault();
    const bounds = window.getNormalBounds();
    closing = true;
    void store
      .save(store.preferences, {
        width: bounds.width,
        height: bounds.height,
        maximized: window.isMaximized(),
      })
      .then(() => window.close())
      .catch(() => {
        closing = false;
        // Keep the window open so a failed write cannot silently discard the saved state.
        dialog.showErrorBox(
          'Unable to save window state',
          'Check available disk space and try closing again. You can disable Remember window size in Settings.',
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
    throw error;
  }

  return window;
}
