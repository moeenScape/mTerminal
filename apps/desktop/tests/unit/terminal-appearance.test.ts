import { describe, expect, it } from 'vitest';
import {
  defaultTerminalAppearance,
  terminalOptions,
  terminalThemes,
} from '../../src/renderer/src/features/workspace/appearance.js';

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => {
    const value = parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

const textColours = [
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
] as const;

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

  it('keeps text and coloured output readable in every theme', () => {
    for (const [name, theme] of Object.entries(terminalThemes)) {
      expect(
        contrast(theme.foreground, theme.background),
        `${name} foreground`,
      ).toBeGreaterThanOrEqual(4.5);
      for (const colour of textColours)
        expect(
          contrast(theme[colour], theme.background),
          `${name} ${colour}`,
        ).toBeGreaterThanOrEqual(3);
      expect(contrast(theme.cursor, theme.background), `${name} cursor`).toBeGreaterThanOrEqual(3);
    }
  });
});
