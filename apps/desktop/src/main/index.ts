import { join } from 'node:path';
import { LocalDatabase } from './storage/database.js';
import { app, BrowserWindow, dialog, Menu, type MenuItemConstructorOptions } from 'electron';
import { createMainWindow } from './window.js';

app.setName('mTerminal');
let database: LocalDatabase | undefined;
app.on('will-quit', () => {
  database?.close();
  database = undefined;
});

function reportStartupError(error: unknown): void {
  console.error('Unable to start mTerminal:', error);
  dialog.showErrorBox(
    'Unable to open mTerminal',
    'The application could not start. Please restart it.',
  );
  database?.close();
  database = undefined;
  app.exit(1);
}

function openMainWindow(): void {
  void createMainWindow().catch(reportStartupError);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (app.isReady() && BrowserWindow.getAllWindows().length === 0) openMainWindow();
  });

  void app
    .whenReady()
    .then(async () => {
      database = await LocalDatabase.open(join(app.getPath('userData'), 'mterminal.sqlite'));
      if (process.platform === 'win32') app.setAppUserModelId('com.mterminal.desktop');

      const template: MenuItemConstructorOptions[] = [
        ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
        { role: 'fileMenu' },
        { role: 'editMenu' },
        {
          label: 'View',
          submenu: [
            ...(!app.isPackaged
              ? [{ role: 'reload' as const }, { role: 'toggleDevTools' as const }]
              : []),
            { role: 'resetZoom' },
            { role: 'zoomIn' },
            { role: 'zoomOut' },
            { type: 'separator' },
            { role: 'togglefullscreen' },
          ],
        },
        { role: 'windowMenu' },
      ];
      Menu.setApplicationMenu(Menu.buildFromTemplate(template));
      openMainWindow();
    })
    .catch(reportStartupError);
}
