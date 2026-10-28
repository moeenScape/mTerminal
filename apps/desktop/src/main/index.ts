import { applicationMenu } from './menus.js';
import { DiagnosticLog } from './diagnostics.js';
import { AppFailure, failureCode } from './failures.js';
import { failureMessages, type FailureCode } from '../shared/failures.js';
import { join, resolve } from 'node:path';
import { LocalDatabase } from './storage/database.js';
import { app, BrowserWindow, dialog, Menu } from 'electron';
import { createMainWindow } from './window.js';

app.setName('mTerminal');
// Isolate development/E2E profiles before the single-instance lock and any data access.
if (!app.isPackaged && process.env.MTERMINAL_USER_DATA) {
  app.setPath('userData', resolve(process.env.MTERMINAL_USER_DATA));
}
let database: LocalDatabase | undefined;
const diagnostics = new DiagnosticLog(join(app.getPath('userData'), 'logs/diagnostics.log'));
let failing = false;
function closeDatabase(): void {
  try {
    database?.close();
  } catch (error) {
    diagnostics.record('shutdown-failed', failureCode(error, 'unexpected'));
  } finally {
    database = undefined;
  }
}
app.on('will-quit', closeDatabase);
function reportFatalError(error: unknown, fallback: FailureCode = 'unexpected'): void {
  if (failing) return;
  failing = true;
  const code = failureCode(error, fallback);
  const logged = diagnostics.record('startup-failed', code);
  dialog.showErrorBox(
    'Unable to continue mTerminal',
    failureMessages[code] +
      `\n\nCode: ${code}\nData directory: ${app.getPath('userData')}\n` +
      (logged
        ? 'Diagnostics: logs/diagnostics.log'
        : 'Diagnostics could not be written. Check directory access and disk space.'),
  );
  closeDatabase();
  app.exit(1);
}
process.on('uncaughtException', (error) => {
  diagnostics.record('unexpected-error', failureCode(error, 'unexpected'));
  reportFatalError(error);
});
process.on('unhandledRejection', (error: unknown) => {
  diagnostics.record('unexpected-error', failureCode(error, 'unexpected'));
  reportFatalError(error);
});
function openMainWindow(): void {
  if (!database) throw new Error('Database unavailable.');
  void createMainWindow(diagnostics, database)
    .then(() => {
      diagnostics.record('startup-ready');
    })
    .catch((error: unknown) => reportFatalError(error, 'renderer-load'));
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
      try {
        database = await LocalDatabase.open(join(app.getPath('userData'), 'mterminal.sqlite'));
      } catch (error) {
        throw new AppFailure(failureCode(error, 'database-open'));
      }
      if (process.platform === 'win32') app.setAppUserModelId('com.mterminal.desktop');

      Menu.setApplicationMenu(
        Menu.buildFromTemplate(applicationMenu(process.platform, app.isPackaged)),
      );
      openMainWindow();
    })
    .catch((error: unknown) => reportFatalError(error));
}
