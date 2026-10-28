import { isWorkspaceShortcut } from '../../src/renderer/src/components/keyboard.js';
import { describe, expect, it } from 'vitest';
import {
  MAX_INPUT,
  terminalInputChunks,
  validTerminalInput,
} from '../../src/shared/terminal-input.js';
import { applicationMenu } from '../../src/main/menus.js';
import type { MenuItemConstructorOptions } from 'electron';

function items(menu: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return menu.flatMap((item) => [
    item,
    ...(Array.isArray(item.submenu) ? items(item.submenu) : []),
  ]);
}

describe('terminal input transport', () => {
  it('preserves multilingual text and a surrogate pair at the IPC size boundary', () => {
    const text = 'a'.repeat(MAX_INPUT - 1) + '😀 বাংলা 中文 e\u0301\r';
    const chunks = [...terminalInputChunks(text)];
    expect(chunks.map((chunk) => chunk.data).join('')).toBe(text);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.data.length).toBe(MAX_INPUT - 1);
    expect(chunks[1]?.data.startsWith('😀')).toBe(true);
    expect(chunks.every(validTerminalInput)).toBe(true);
  });
  it('keeps control sequences byte-for-byte and ignores empty events', () => {
    const data = '\x03\t\x1b[A\x7f\r\x1b[200~hello\x1b[201~';
    expect([...terminalInputChunks(data)]).toEqual([{ kind: 'text', data }]);
    expect([...terminalInputChunks('')]).toEqual([]);
  });
  it('accepts all eight-bit binary values and rejects oversized or malformed payloads', () => {
    const data = String.fromCharCode(...Array.from({ length: 256 }, (_, index) => index));
    expect(validTerminalInput({ kind: 'binary', data })).toBe(true);
    expect(
      [...terminalInputChunks(data.repeat(300), 'binary')].map((chunk) => chunk.data).join(''),
    ).toBe(data.repeat(300));
    for (const invalid of [
      null,
      'raw string',
      {},
      { kind: 'text', data: '' },
      { kind: 'unknown', data: 'a' },
      { kind: 'binary', data: '😀' },
      { kind: 'text', data: 'x'.repeat(MAX_INPUT + 1) },
    ]) {
      expect(validTerminalInput(invalid)).toBe(false);
    }
  });
});

describe('terminal-friendly native accelerators', () => {
  it.each(['linux', 'win32'] as const)('keeps shell Ctrl keys available on %s', (platform) => {
    const menu = items(applicationMenu(platform, false));
    const shortcuts = menu.map((item) => item.accelerator);
    for (const key of ['Ctrl+C', 'Ctrl+W', 'Ctrl+R', 'Ctrl+Z', 'Ctrl+A', 'Ctrl+Q', 'Ctrl+M'])
      expect(shortcuts).not.toContain(key);
    expect(menu.find((item) => item.role === 'copy')?.accelerator).toBe('Ctrl+Shift+C');
    expect(menu.find((item) => item.role === 'reload')?.accelerator).toBe('Ctrl+Shift+R');
  });
  it('retains macOS native roles and omits developer actions from packaged apps', () => {
    const mac = applicationMenu('darwin', false);
    expect(mac.map((item) => item.role)).toContain('editMenu');
    for (const platform of ['darwin', 'linux', 'win32'] as const) {
      expect(
        items(applicationMenu(platform, true)).some(
          (item) => item.role === 'reload' || item.role === 'toggleDevTools',
        ),
      ).toBe(false);
    }
  });
});

describe('composition and terminal navigation shortcuts', () => {
  it('recognizes reserved navigation keys without consuming AltGr or composed text', () => {
    const event = {
      key: '1',
      ctrlKey: true,
      altKey: true,
      shiftKey: false,
      metaKey: false,
      isComposing: false,
      getModifierState: () => false,
    } as unknown as KeyboardEvent;
    expect(isWorkspaceShortcut(event)).toBe(true);
    expect(isWorkspaceShortcut({ ...event, isComposing: true })).toBe(false);
    expect(isWorkspaceShortcut({ ...event, getModifierState: () => true })).toBe(false);
    expect(isWorkspaceShortcut({ ...event, key: '4' })).toBe(false);
    expect(isWorkspaceShortcut({ ...event, metaKey: true })).toBe(false);
  });
});
