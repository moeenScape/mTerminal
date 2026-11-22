import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SerialPortMock } from 'serialport';

const MockBinding = SerialPortMock.binding;
import {
  defaultSerialSettings,
  describeSerial,
  translateNewlines,
  validSerialPath,
  validateSerialSettings,
  MAX_SERIAL_PROFILES,
  type SerialSettings,
} from '../../src/shared/serial.js';
import { openSerial, serialFailure } from '../../src/main/terminal/serial.js';
import { LocalDatabase } from '../../src/main/storage/database.js';
import { tabsReducer } from '../../src/renderer/src/features/workspace/tabs.js';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  MockBinding.reset();
});
const settings = (patch: Partial<SerialSettings> = {}): SerialSettings => ({
  ...defaultSerialSettings,
  path: '/dev/ttyUSB0',
  ...patch,
});
const MockPort = SerialPortMock as unknown as Parameters<typeof openSerial>[2];

describe('serial settings', () => {
  it('validates device paths and line settings', () => {
    expect(validateSerialSettings(settings({ name: '' }))).toMatchObject({
      name: '/dev/ttyUSB0',
      baudRate: 115200,
      dataBits: 8,
      parity: 'none',
      stopBits: 1,
    });
    for (const path of ['/dev/ttyUSB0', '/dev/tty.usbserial-1410', 'COM3', '\\\\.\\COM12'])
      expect(validSerialPath(path)).toBe(true);
    for (const path of ['', 'ttyUSB0', '/dev/../etc/passwd', '/dev/tty USB', 'COM', 'C:\\x'])
      expect(validSerialPath(path)).toBe(false);
    for (const bad of [
      settings({ baudRate: 0 }),
      settings({ dataBits: 9 as 8 }),
      settings({ parity: 'odd-ish' as 'odd' }),
      settings({ stopBits: 3 as 2 }),
      settings({ flowControl: 'dtr' as 'none' }),
      settings({ newline: 'nl' as 'cr' }),
      { ...settings(), extra: true },
    ])
      expect(() => validateSerialSettings(bad)).toThrow();
  });
  it('translates Enter and describes settings', () => {
    expect(translateNewlines('ls\r', 'cr')).toBe('ls\r');
    expect(translateNewlines('ls\r', 'lf')).toBe('ls\n');
    expect(translateNewlines('ls\r', 'crlf')).toBe('ls\r\n');
    expect(describeSerial(settings({ baudRate: 9600, parity: 'even' }))).toBe(
      '/dev/ttyUSB0 · 9600 8E1',
    );
  });
  it('maps operating system errors to actionable failures', () => {
    expect(serialFailure(new Error('Error: Permission denied, cannot open /dev/ttyUSB0'))).toBe(
      'serial-permission',
    );
    expect(
      serialFailure(new Error('Error Resource temporarily unavailable Cannot lock port')),
    ).toBe('serial-busy');
    expect(serialFailure(new Error('Error: No such file or directory'))).toBe('serial-missing');
    expect(serialFailure(new Error('weird'))).toBe('serial-failed');
  });
});

describe('serial transport', () => {
  it('sends translated input, receives output and reports unplugging as a disconnect', async () => {
    MockBinding.createPort('/dev/ttyUSB0', { echo: true, record: true });
    const transport = await openSerial(
      settings({ newline: 'crlf' }),
      new AbortController().signal,
      MockPort,
    );
    const received: string[] = [];
    transport.onData((data) => received.push(data));
    const exited = new Promise((resolve) => transport.onExit(resolve));
    transport.write('show version\r');
    await expect.poll(() => received.join(''), { timeout: 2000 }).toBe('show version\r\n');
    transport.kill();
    await expect(exited).resolves.toMatchObject({ connectionState: 'disconnected' });
  });
  it('echoes locally when the device does not', async () => {
    MockBinding.createPort('/dev/ttyUSB1', { echo: false });
    const transport = await openSerial(
      settings({ path: '/dev/ttyUSB1', localEcho: true }),
      new AbortController().signal,
      MockPort,
    );
    cleanups.push(() => transport.kill());
    const received: string[] = [];
    transport.onData((data) => received.push(data));
    transport.write('a\x7f\r');
    expect(received.join('')).toBe('a\b \b\r\n');
  });
  it('fails clearly for a missing device and honours cancellation', async () => {
    await expect(
      openSerial(settings({ path: '/dev/ttyMISSING' }), new AbortController().signal, MockPort),
    ).rejects.toMatchObject({ code: 'serial-missing' });
    const controller = new AbortController();
    controller.abort();
    await expect(openSerial(settings(), controller.signal, MockPort)).rejects.toMatchObject({
      code: 'ssh-cancelled',
    });
  });
});

describe('serial profiles and tabs', () => {
  it('persists profiles with a limit', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mterminal-serial-'));
    const database = await LocalDatabase.open(join(directory, 'data.sqlite'));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    cleanups.push(() => database.close());
    const profile = database.saveSerialProfile(settings({ name: 'Router', baudRate: 9600 }));
    expect(database.listSerialProfiles()).toEqual([profile]);
    const edited = database.saveSerialProfile(settings({ name: 'Switch' }), profile.id);
    expect(database.listSerialProfiles()).toEqual([edited]);
    for (let index = 1; index < MAX_SERIAL_PROFILES; index++)
      database.saveSerialProfile(settings({ name: `P${index}` }));
    expect(() => database.saveSerialProfile(settings())).toThrow(/Too many/);
    database.deleteSerialProfile(profile.id);
    expect(database.listSerialProfiles()).toHaveLength(MAX_SERIAL_PROFILES - 1);
  });
  it('opens serial tabs without copying the device to splits', () => {
    const id = crypto.randomUUID();
    const split = crypto.randomUUID();
    let state = tabsReducer(
      { tabs: [], layouts: [], activeId: null },
      { type: 'add', id, title: 'Router', serialId: crypto.randomUUID() },
    );
    expect(state.tabs[0]?.serialId).toBeDefined();
    state = tabsReducer(state, {
      type: 'split',
      id: split,
      sourceId: id,
      title: 'Local',
      direction: 'right',
    });
    expect(state.tabs[1]).not.toHaveProperty('serialId');
  });
});
