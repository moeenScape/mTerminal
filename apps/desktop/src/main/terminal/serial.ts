import { createRequire } from 'node:module';
import { StringDecoder } from 'node:string_decoder';
import type * as SerialPortModule from 'serialport';
import {
  translateNewlines,
  type SerialPortInfo,
  type SerialSettings,
} from '../../shared/serial.js';
import type { FailureCode } from '../../shared/failures.js';
import { AppFailure } from '../failures.js';
import type { TerminalExit, TerminalTransport } from './transport.js';

const require = createRequire(import.meta.url);
let serialModule: typeof SerialPortModule | undefined;
/** Loaded on first use so a missing native binding only affects serial features. */
function serialport(): typeof SerialPortModule {
  serialModule ??= require('serialport') as typeof SerialPortModule;
  return serialModule;
}

const BREAK_MS = 300;

export function serialFailure(error: unknown): FailureCode {
  const text = error instanceof Error ? error.message : String(error ?? '');
  if (/EACCES|permission denied|access is denied/i.test(text)) return 'serial-permission';
  if (/EBUSY|resource busy|cannot lock|in use|EAGAIN/i.test(text)) return 'serial-busy';
  if (/ENOENT|no such file|not found|cannot find|file not found/i.test(text))
    return 'serial-missing';
  return 'serial-failed';
}

/** Lists serial devices, hiding Linux's placeholder ttyS ports that have no hardware. */
export async function listSerialPorts(): Promise<SerialPortInfo[]> {
  const ports = await serialport().SerialPort.list();
  return ports
    .filter((port) => !(/^\/dev\/ttyS\d+$/.test(port.path) && !port.manufacturer && !port.vendorId))
    .slice(0, 100)
    .map((port) => ({
      path: port.path,
      manufacturer: String(port.manufacturer ?? '').slice(0, 100),
      serialNumber: String(port.serialNumber ?? '').slice(0, 100),
      vendorId: String(port.vendorId ?? '').slice(0, 8),
      productId: String(port.productId ?? '').slice(0, 8),
    }));
}

export interface SerialTransport extends TerminalTransport {
  sendBreak: () => Promise<void>;
}

/** Opens a serial device as a terminal transport; unplugging ends it as "disconnected". */
export function openSerial(
  settings: SerialSettings,
  signal: AbortSignal,
  /** Port class; tests pass serialport's SerialPortMock. */
  Port: typeof SerialPortModule.SerialPort = serialport().SerialPort,
): Promise<SerialTransport> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new AppFailure('ssh-cancelled'));
      return;
    }
    const port = new Port({
      path: settings.path,
      baudRate: settings.baudRate,
      dataBits: settings.dataBits,
      parity: settings.parity,
      stopBits: settings.stopBits,
      rtscts: settings.flowControl === 'rtscts',
      xon: settings.flowControl === 'xonxoff',
      xoff: settings.flowControl === 'xonxoff',
      autoOpen: false,
      lock: true,
    });
    const decoder = new StringDecoder('utf8');
    const dataListeners = new Set<(data: string) => void>();
    const exitListeners = new Set<(event: TerminalExit) => void>();
    let ended = false;
    let failed = false;
    const emit = (data: string) => {
      if (data) for (const listener of dataListeners) listener(data);
    };
    const end = () => {
      if (ended) return;
      ended = true;
      emit(decoder.end());
      const event: TerminalExit = { exitCode: failed ? 1 : 0, connectionState: 'disconnected' };
      for (const listener of exitListeners) listener(event);
    };
    const aborted = () => {
      if (port.isOpen) port.close(() => {});
    };
    signal.addEventListener('abort', aborted, { once: true });
    port.on('error', () => {
      failed = true;
      if (port.isOpen) port.close(() => {});
      else end();
    });
    port.open((error) => {
      signal.removeEventListener('abort', aborted);
      if (error || signal.aborted) {
        if (port.isOpen) port.close(() => {});
        reject(new AppFailure(signal.aborted ? 'ssh-cancelled' : serialFailure(error)));
        return;
      }
      port.pause();
      port.on('data', (chunk: Buffer) => emit(decoder.write(chunk)));
      port.on('close', (closeError?: { disconnected?: boolean } | null) => {
        if (closeError) failed = closeError.disconnected !== true;
        end();
      });
      resolve({
        write: (data) => {
          if (ended || !port.isOpen) return;
          const text = typeof data === 'string' ? data : data.toString('latin1');
          const output = translateNewlines(text, settings.newline);
          port.write(typeof data === 'string' ? output : Buffer.from(output, 'latin1'));
          if (settings.localEcho && typeof data === 'string')
            emit(text.replace(/\r/g, '\r\n').replace(/\x7f/g, '\b \b'));
        },
        // A serial line has no window size.
        resize: () => {},
        pause: () => port.pause(),
        resume: () => port.resume(),
        kill: () => {
          if (port.isOpen) port.close(() => end());
          else end();
        },
        onData: (listener) => {
          dataListeners.add(listener);
          port.resume();
          return { dispose: () => dataListeners.delete(listener) };
        },
        onExit: (listener) => {
          exitListeners.add(listener);
          if (ended)
            queueMicrotask(() => listener({ exitCode: 0, connectionState: 'disconnected' }));
          return { dispose: () => exitListeners.delete(listener) };
        },
        sendBreak: () =>
          new Promise<void>((done, fail) => {
            if (ended || !port.isOpen) {
              fail(new AppFailure('serial-failed'));
              return;
            }
            port.set({ brk: true }, (setError) => {
              if (setError) {
                fail(new AppFailure('serial-failed'));
                return;
              }
              setTimeout(() => {
                if (!port.isOpen) {
                  done();
                  return;
                }
                port.set({ brk: false }, () => done());
              }, BREAK_MS);
            });
          }),
      });
    });
  });
}
