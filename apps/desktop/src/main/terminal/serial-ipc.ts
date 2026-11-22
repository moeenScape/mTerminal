import { ipcMain, type BrowserWindow } from 'electron';
import { validHostId } from '../../shared/hosts.js';
import { serialChannels } from '../../shared/serial.js';
import {
  validTerminalId,
  validTerminalSize,
  type TerminalOpenResult,
} from '../../shared/terminal.js';
import type { DiagnosticLog } from '../diagnostics.js';
import { failureCode } from '../failures.js';
import { validateAppInfoRequest } from '../security.js';
import type { LocalDatabase } from '../storage/database.js';
import type { TerminalRegistry } from './registry.js';
import { listSerialPorts, openSerial, serialFailure } from './serial.js';

type SerialResponse<T> = { ok: true; value: T } | { ok: false; message: string };

/** Serial profiles, device listing, opening serial tabs and sending breaks. */
export function attachSerial(
  window: BrowserWindow,
  rendererUrl: string,
  terminals: TerminalRegistry,
  database: LocalDatabase,
  diagnostics: DiagnosticLog,
) {
  const owner = window.webContents;
  const managed = [
    serialChannels.ports,
    serialChannels.profiles,
    serialChannels.save,
    serialChannels.delete,
    serialChannels.sendBreak,
  ];
  for (const channel of managed)
    ipcMain.handle(channel, async (event, ...args: unknown[]): Promise<SerialResponse<unknown>> => {
      validateAppInfoRequest(event, owner, rendererUrl, []);
      try {
        if (channel === serialChannels.ports && !args.length)
          return { ok: true, value: await listSerialPorts() };
        if (channel === serialChannels.profiles && !args.length)
          return { ok: true, value: database.listSerialProfiles() };
        if (
          channel === serialChannels.save &&
          (args.length === 1 || args.length === 2) &&
          (args[1] === undefined || validHostId(args[1]))
        )
          return { ok: true, value: database.saveSerialProfile(args[0], args[1]) };
        if (channel === serialChannels.delete && args.length === 1 && validHostId(args[0])) {
          database.deleteSerialProfile(args[0]);
          return { ok: true, value: undefined };
        }
        if (channel === serialChannels.sendBreak && args.length === 1 && validTerminalId(args[0])) {
          await terminals.sendBreak(args[0]);
          return { ok: true, value: undefined };
        }
        throw new Error('Invalid serial request.');
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        return {
          ok: false,
          message: /^(Choose|Enter|Use|Too many|Serial profile no longer)/.test(message)
            ? message
            : channel === serialChannels.ports
              ? 'Unable to list serial devices. Rebuild native modules with npm run rebuild:native if this repeats.'
              : channel === serialChannels.sendBreak
                ? 'Unable to send a break. The serial device may have disconnected.'
                : 'Serial operation failed. Check the fields and local storage, then retry.',
        };
      }
    });
  ipcMain.handle(
    serialChannels.open,
    async (event, ...args: unknown[]): Promise<TerminalOpenResult> => {
      validateAppInfoRequest(event, owner, rendererUrl, []);
      try {
        const [id, size, profileId] = args;
        if (
          args.length !== 3 ||
          !validTerminalId(id) ||
          !validTerminalSize(size) ||
          !validHostId(profileId)
        )
          throw new Error('Invalid request.');
        const profile = database.listSerialProfiles().find((item) => item.id === profileId);
        if (!profile) return { ok: false, code: 'serial-missing' };
        await terminals.open(id, size, (signal) => openSerial(profile, signal));
        return { ok: true };
      } catch (error) {
        const code = failureCode(error, serialFailure(error));
        diagnostics.record('terminal-open-failed', code);
        return { ok: false, code };
      }
    },
  );
  window.once('closed', () => {
    for (const channel of Object.values(serialChannels)) ipcMain.removeHandler(channel);
  });
}
