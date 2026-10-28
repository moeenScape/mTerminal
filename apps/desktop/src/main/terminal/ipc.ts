import { validTerminalInput } from '../../shared/terminal-input.js';
import { failureCode } from '../failures.js';
import { homedir } from 'node:os';
import { ipcMain, type BrowserWindow } from 'electron';
import {
  terminalChannels as channels,
  validTerminalId,
  validTerminalSize,
  type TerminalSize,
  type TerminalOpenResult,
} from '../../shared/terminal.js';
import { validateAppInfoRequest } from '../security.js';
import type { DiagnosticLog } from '../diagnostics.js';
import { chooseShell, discoverShells } from './shells.js';
import { TerminalRegistry } from './registry.js';

export function attachTerminal(
  window: BrowserWindow,
  rendererUrl: string,
  shellOverride: () => string,
  diagnostics: DiagnosticLog,
): void {
  const terminal = new TerminalRegistry((event) => {
    if (event.kind === 'error') diagnostics.record('terminal-operation-failed', event.code);
    if (!window.webContents.isDestroyed()) window.webContents.send(channels.event, event);
  });
  ipcMain.handle(channels.shells, async (event, ...args: unknown[]) => {
    validateAppInfoRequest(event, window.webContents, rendererUrl, args);
    try {
      return await discoverShells();
    } catch {
      return [];
    }
  });
  ipcMain.handle(channels.open, async (event, ...args: unknown[]): Promise<TerminalOpenResult> => {
    validateAppInfoRequest(event, window.webContents, rendererUrl, []);
    const [id, size] = args;
    if (args.length !== 2 || !validTerminalId(id) || !validTerminalSize(size))
      return { ok: false, code: 'terminal-failed' };
    try {
      await terminal.open(id, size, async () => {
        const shell = await chooseShell(shellOverride());
        const { spawn } = await import('node-pty');
        const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
        for (const key of [
          'ELECTRON_RUN_AS_NODE',
          'ELECTRON_RENDERER_URL',
          'MTERMINAL_USER_DATA',
          'NODE_OPTIONS',
        ])
          delete env[key as keyof typeof env];
        return spawn(shell, [], {
          name: 'xterm-256color',
          cwd: homedir(),
          cols: size.cols,
          rows: size.rows,
          env,
        });
      });
      return { ok: true };
    } catch (error) {
      const code = failureCode(error, 'terminal-failed');
      diagnostics.record('terminal-open-failed', code);
      return { ok: false, code };
    }
  });
  const operations = [channels.write, channels.resize, channels.ack, channels.close] as const;
  for (const channel of operations) {
    ipcMain.on(channel, (event, ...args: unknown[]) => {
      let ownedId: string | undefined;
      try {
        validateAppInfoRequest(event, window.webContents, rendererUrl, []);
        const [id, value] = args;
        if (!validTerminalId(id) || args.length !== (channel === channels.close ? 1 : 2))
          throw new Error('Invalid terminal request.');
        ownedId = id;
        if (channel === channels.close) terminal.close(id);
        else if (channel === channels.write && validTerminalInput(value)) terminal.write(id, value);
        else if (channel === channels.resize && validTerminalSize(value))
          terminal.resize(id, value as TerminalSize);
        else if (
          channel === channels.ack &&
          typeof value === 'number' &&
          Number.isInteger(value) &&
          value > 0 &&
          value <= 1024 * 1024
        )
          terminal.ack(id, value);
        else throw new Error('Invalid terminal request.');
      } catch {
        diagnostics.record('terminal-operation-failed', 'terminal-failed');
        if (ownedId) {
          terminal.close(ownedId);
          if (!window.webContents.isDestroyed())
            window.webContents.send(channels.event, {
              kind: 'error',
              id: ownedId,
              code: 'terminal-failed',
            });
        }
      }
    });
  }
  // Reset only after a committed main-frame navigation, not a blocked link attempt.
  window.webContents.on('did-navigate', () => terminal.reset());
  window.webContents.on('render-process-gone', () => terminal.reset());
  window.once('closed', () => {
    terminal.dispose();
    ipcMain.removeHandler(channels.open);
    ipcMain.removeHandler(channels.shells);
    for (const channel of operations) ipcMain.removeAllListeners(channel);
  });
}
