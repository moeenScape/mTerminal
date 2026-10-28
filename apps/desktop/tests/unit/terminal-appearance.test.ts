import { describe, expect, it } from 'vitest';
import {
  defaultTerminalAppearance,
  terminalOptions,
} from '../../src/renderer/src/features/workspace/appearance.js';

describe('terminal appearance', () => {
  it('follows the app theme by default and applies independent terminal choices', () => {
    expect(terminalOptions(defaultTerminalAppearance, 'dark').theme.background).toBe('#141620');
    expect(terminalOptions(defaultTerminalAppearance, 'light').theme.background).toBe('#f5f6fa');
    const customized = terminalOptions(
      {
        ...defaultTerminalAppearance,
        theme: 'light',
        font: 'monospace',
        fontSize: 20,
        zoom: 125,
        cursor: 'bar',
        blink: false,
      },
      'dark',
    );
    expect(customized).toMatchObject({
      fontFamily: 'monospace',
      fontSize: 25,
      cursorStyle: 'bar',
      cursorBlink: false,
      theme: { background: '#f5f6fa' },
    });
    expect(defaultTerminalAppearance.fontSize).toBe(14);
  });
});
