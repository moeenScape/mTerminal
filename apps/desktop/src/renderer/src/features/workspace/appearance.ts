import type { ITheme } from '@xterm/xterm';
export type TerminalTheme = 'system' | 'dark' | 'light' | 'solarized-dark' | 'high-contrast';
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

/** Bundled with the app, so the terminal looks the same on every platform. */
export const BUNDLED_TERMINAL_FONT = 'JetBrains Mono';

const fonts: Record<TerminalFont, string> = {
  default: `"${BUNDLED_TERMINAL_FONT}", "DejaVu Sans Mono", Consolas, monospace`,
  monospace: 'monospace',
  dejavu: '"DejaVu Sans Mono", monospace',
};

export const terminalFontLabels: Record<TerminalFont, string> = {
  default: `${BUNDLED_TERMINAL_FONT} (bundled)`,
  monospace: 'System monospace',
  dejavu: 'DejaVu Sans Mono',
};

export const terminalThemeLabels: Record<TerminalTheme, string> = {
  system: 'Follow app',
  dark: 'mTerminal Dark',
  light: 'mTerminal Light',
  'solarized-dark': 'Solarized Dark',
  'high-contrast': 'High contrast',
};

/** Complete palettes, including all 16 ANSI colours used by shells and tools. */
export const terminalThemes: Record<Exclude<TerminalTheme, 'system'>, Required<ITheme>> = {
  dark: palette({
    background: '#141620',
    foreground: '#edf0f7',
    cursor: '#8bd8c0',
    selectionBackground: '#2f5a50',
    // prettier-ignore
    ansi: [
      '#3a3f52', '#f07178', '#8bd8a4', '#f2c66d', '#7aa7ff', '#c792ea', '#78d6e0', '#c9cfdc',
      '#6b7389', '#ff8f96', '#a6e8bc', '#ffd98a', '#9dc0ff', '#dbb0f5', '#9ee6ee', '#ffffff',
    ],
  }),
  light: palette({
    background: '#f5f6fa',
    foreground: '#182230',
    cursor: '#136c56',
    selectionBackground: '#c3e3d8',
    // prettier-ignore
    ansi: [
      '#182230', '#b3242a', '#1b6e40', '#835600', '#1f5bb5', '#7e33aa', '#0d6b76', '#5d6677',
      '#4c596c', '#c9303a', '#1f7d49', '#946200', '#2a68c9', '#8f40bd', '#107985', '#3e4757',
    ],
  }),
  'solarized-dark': palette({
    background: '#002b36',
    foreground: '#93a1a1',
    cursor: '#93a1a1',
    selectionBackground: '#174652',
    // prettier-ignore
    ansi: [
      '#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5',
      '#657b83', '#cb4b16', '#a3b72f', '#d3a62b', '#5ba7e8', '#6c71c4', '#56c2b8', '#fdf6e3',
    ],
  }),
  'high-contrast': palette({
    background: '#000000',
    foreground: '#ffffff',
    cursor: '#ffff00',
    selectionBackground: '#4d4d00',
    // prettier-ignore
    ansi: [
      '#000000', '#ff6b6b', '#5cff7a', '#ffff5c', '#7ab0ff', '#ff7aff', '#5cffff', '#e6e6e6',
      '#a6a6a6', '#ff9999', '#99ffaa', '#ffff99', '#a6c8ff', '#ffa6ff', '#99ffff', '#ffffff',
    ],
  }),
};

function palette(value: {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
  ansi: string[];
}): Required<ITheme> {
  const [black, red, green, yellow, blue, magenta, cyan, white] = value.ansi;
  const [brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightMagenta] =
    value.ansi.slice(8);
  return {
    background: value.background,
    foreground: value.foreground,
    cursor: value.cursor,
    cursorAccent: value.background,
    selectionBackground: value.selectionBackground,
    selectionForeground: value.foreground,
    selectionInactiveBackground: value.selectionBackground,
    scrollbarSliderBackground: 'rgba(128, 128, 128, 0.25)',
    scrollbarSliderHoverBackground: 'rgba(128, 128, 128, 0.4)',
    scrollbarSliderActiveBackground: 'rgba(128, 128, 128, 0.55)',
    overviewRulerBorder: value.background,
    black: black!,
    red: red!,
    green: green!,
    yellow: yellow!,
    blue: blue!,
    magenta: magenta!,
    cyan: cyan!,
    white: white!,
    brightBlack: brightBlack!,
    brightRed: brightRed!,
    brightGreen: brightGreen!,
    brightYellow: brightYellow!,
    brightBlue: brightBlue!,
    brightMagenta: brightMagenta!,
    brightCyan: value.ansi[14]!,
    brightWhite: value.ansi[15]!,
    extendedAnsi: [],
  };
}

export function terminalOptions(value: TerminalAppearance, applicationTheme: 'dark' | 'light') {
  return {
    theme: terminalThemes[value.theme === 'system' ? applicationTheme : value.theme],
    fontFamily: fonts[value.font],
    fontSize: (value.fontSize * value.zoom) / 100,
    cursorStyle: value.cursor,
    cursorBlink: value.blink,
  };
}
