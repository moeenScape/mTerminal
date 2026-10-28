import type { ITheme } from '@xterm/xterm';
export type TerminalTheme = 'system' | 'dark' | 'light';
export type TerminalFont = 'default' | 'monospace' | 'dejavu';
export type TerminalCursor = 'block' | 'bar' | 'underline';
export interface TerminalAppearance {
  theme: TerminalTheme;
  font: TerminalFont;
  fontSize: number;
  zoom: number;
  cursor: TerminalCursor;
  blink: boolean;
}
export const defaultTerminalAppearance: TerminalAppearance = {
  theme: 'system',
  font: 'default',
  fontSize: 14,
  zoom: 100,
  cursor: 'block',
  blink: true,
};
const fonts: Record<TerminalFont, string> = {
  default: '"DejaVu Sans Mono", Consolas, monospace',
  monospace: 'monospace',
  dejavu: '"DejaVu Sans Mono", monospace',
};
const themes: Record<'dark' | 'light', ITheme> = {
  dark: { background: '#141620', foreground: '#edf0f7', cursor: '#8bd8c0' },
  light: { background: '#f5f6fa', foreground: '#182230', cursor: '#136c56' },
};
export function terminalOptions(value: TerminalAppearance, applicationTheme: 'dark' | 'light') {
  return {
    theme: themes[value.theme === 'system' ? applicationTheme : value.theme],
    fontFamily: fonts[value.font],
    fontSize: (value.fontSize * value.zoom) / 100,
    cursorStyle: value.cursor,
    cursorBlink: value.blink,
  };
}
