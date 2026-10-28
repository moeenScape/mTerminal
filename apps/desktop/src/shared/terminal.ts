import type { TerminalInput } from './terminal-input.js';
import type { FailureCode } from './failures.js';
export const terminalChannels = {
  shells: 'terminal:shells',
  open: 'terminal:open',
  write: 'terminal:write',
  resize: 'terminal:resize',
  ack: 'terminal:ack',
  close: 'terminal:close',
  event: 'terminal:event',
} as const;
export type TerminalOpenResult = { ok: true } | { ok: false; code: FailureCode };
export interface ShellInfo {
  path: string;
  name: string;
}
export type TerminalEvent =
  | { kind: 'data'; id: string; data: string }
  | { kind: 'exit'; id: string; exitCode: number }
  | { kind: 'error'; id: string; code: 'terminal-failed' | 'terminal-overflow' };
export const terminalLimits = { minCols: 2, maxCols: 500, minRows: 1, maxRows: 300 } as const;
export interface TerminalSize {
  cols: number;
  rows: number;
}
export interface TerminalApi {
  getShells: () => Promise<ShellInfo[]>;
  openTerminal: (id: string, size: TerminalSize) => Promise<void>;
  writeTerminal: (id: string, input: TerminalInput) => void;
  resizeTerminal: (id: string, size: TerminalSize) => void;
  ackTerminal: (id: string, count: number) => void;
  closeTerminal: (id: string) => void;
  onTerminalEvent: (listener: (event: TerminalEvent) => void) => () => void;
}
export function validTerminalId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  );
}
export function validTerminalSize(value: unknown): value is TerminalSize {
  if (!value || typeof value !== 'object') return false;
  const size = value as TerminalSize;
  return (
    Number.isInteger(size.cols) &&
    size.cols >= terminalLimits.minCols &&
    size.cols <= terminalLimits.maxCols &&
    Number.isInteger(size.rows) &&
    size.rows >= terminalLimits.minRows &&
    size.rows <= terminalLimits.maxRows
  );
}
