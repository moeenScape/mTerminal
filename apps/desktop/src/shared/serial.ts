export const serialChannels = {
  ports: 'serial:ports',
  profiles: 'serial:profiles',
  save: 'serial:save',
  delete: 'serial:delete',
  open: 'serial:open',
  sendBreak: 'serial:break',
} as const;

export const MAX_SERIAL_PROFILES = 50;
export const SERIAL_BAUD_RATES = [
  300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600,
] as const;

export type SerialParity = 'none' | 'even' | 'odd' | 'mark' | 'space';
export type SerialFlowControl = 'none' | 'rtscts' | 'xonxoff';
/** What the Enter key sends. */
export type SerialNewline = 'cr' | 'lf' | 'crlf';

export interface SerialSettings {
  name: string;
  /** Device path such as /dev/ttyUSB0, /dev/tty.usbserial-1410 or COM3. */
  path: string;
  baudRate: number;
  dataBits: 5 | 6 | 7 | 8;
  parity: SerialParity;
  stopBits: 1 | 1.5 | 2;
  flowControl: SerialFlowControl;
  newline: SerialNewline;
  /** Echo typed characters locally, for devices that do not echo. */
  localEcho: boolean;
}
export interface SerialProfile extends SerialSettings {
  id: string;
}
export interface SerialPortInfo {
  path: string;
  manufacturer: string;
  serialNumber: string;
  vendorId: string;
  productId: string;
}

export interface SerialApi {
  listSerialPorts: () => Promise<SerialPortInfo[]>;
  listSerialProfiles: () => Promise<SerialProfile[]>;
  saveSerialProfile: (settings: SerialSettings, id?: string) => Promise<SerialProfile>;
  deleteSerialProfile: (id: string) => Promise<void>;
  openSerialTerminal: (
    id: string,
    size: import('./terminal.js').TerminalSize,
    profileId: string,
  ) => Promise<void>;
  sendSerialBreak: (id: string) => Promise<void>;
}

export const defaultSerialSettings: SerialSettings = {
  name: '',
  path: '',
  baudRate: 115200,
  dataBits: 8,
  parity: 'none',
  stopBits: 1,
  flowControl: 'none',
  newline: 'cr',
  localEcho: false,
};

const control = (value: string) =>
  Array.from(value).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);

export function validSerialPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 255 &&
    !control(value) &&
    (/^\/dev\/[A-Za-z0-9._/-]+$/.test(value) || /^(\\\\\.\\)?COM\d{1,3}$/i.test(value)) &&
    !value.includes('..')
  );
}

export function validateSerialSettings(value: unknown): SerialSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid serial settings.');
  const v = value as Record<string, unknown>;
  const keys = Object.keys(defaultSerialSettings);
  if (Object.keys(v).some((key) => !keys.includes(key)))
    throw new Error('Invalid serial settings.');
  const path = typeof v.path === 'string' ? v.path.trim() : '';
  if (!validSerialPath(path))
    throw new Error('Choose a serial device such as /dev/ttyUSB0 or COM3.');
  if (!Number.isInteger(v.baudRate) || Number(v.baudRate) < 50 || Number(v.baudRate) > 4000000)
    throw new Error('Enter a baud rate between 50 and 4000000.');
  if (![5, 6, 7, 8].includes(Number(v.dataBits))) throw new Error('Choose 5–8 data bits.');
  if (!['none', 'even', 'odd', 'mark', 'space'].includes(String(v.parity)))
    throw new Error('Choose a parity.');
  if (![1, 1.5, 2].includes(Number(v.stopBits))) throw new Error('Choose 1, 1.5 or 2 stop bits.');
  if (!['none', 'rtscts', 'xonxoff'].includes(String(v.flowControl)))
    throw new Error('Choose a flow control.');
  if (!['cr', 'lf', 'crlf'].includes(String(v.newline))) throw new Error('Choose a line ending.');
  if (v.localEcho !== undefined && typeof v.localEcho !== 'boolean')
    throw new Error('Invalid local echo setting.');
  const name = typeof v.name === 'string' && v.name.trim() ? v.name.trim() : path;
  if (name.length > 64 || control(name)) throw new Error('Use a name of at most 64 characters.');
  return {
    name,
    path,
    baudRate: Number(v.baudRate),
    dataBits: Number(v.dataBits) as SerialSettings['dataBits'],
    parity: v.parity as SerialParity,
    stopBits: Number(v.stopBits) as SerialSettings['stopBits'],
    flowControl: v.flowControl as SerialFlowControl,
    newline: v.newline as SerialNewline,
    localEcho: v.localEcho === true,
  };
}

/** Translates the terminal's Enter (CR) into the device's expected line ending. */
export function translateNewlines(data: string, newline: SerialNewline): string {
  if (newline === 'cr') return data;
  return data.replace(/\r/g, newline === 'lf' ? '\n' : '\r\n');
}

export function describeSerial(settings: SerialSettings): string {
  const parity = settings.parity[0]!.toUpperCase();
  return `${settings.path} · ${settings.baudRate} ${settings.dataBits}${parity}${settings.stopBits}`;
}
