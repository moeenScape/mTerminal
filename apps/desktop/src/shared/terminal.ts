import type { TerminalInput } from './terminal-input.js';
import type { FailureCode } from './failures.js';
export const TERMINAL_SCROLLBACK_LINES = 3000;
export const MAX_TERMINAL_TABS = 16;
export const terminalChannels = {
  shells: 'terminal:shells',
  completePaths: 'terminal:complete-paths',
  open: 'terminal:open',
  ssh: 'terminal:ssh',
  installPublicKey: 'terminal:install-public-key',
  sshChallenge: 'terminal:ssh-challenge',
  sshAnswer: 'terminal:ssh-answer',
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
export const sshStateMessages = {
  connecting: 'SSH connecting…',
  verifying: 'SSH verifying server identity…',
  authenticating: 'SSH authenticating…',
  'opening-shell': 'SSH opening remote shell…',
  connected: 'SSH connected',
} as const;
export type SshConnectionState = keyof typeof sshStateMessages;
export type TerminalEvent =
  | { kind: 'history-status'; id: string; status: 'unsupported' | 'starting' }
  | { kind: 'history-error'; id: string; code: FailureCode }
  | { kind: 'state'; id: string; state: SshConnectionState }
  | { kind: 'data'; id: string; data: string }
  | {
      kind: 'exit';
      id: string;
      exitCode: number;
      connectionState?: 'disconnected' | 'failed';
      failureCode?: 'ssh-keepalive-timeout';
    }
  | { kind: 'error'; id: string; code: 'terminal-failed' | 'terminal-overflow' };
export const terminalLimits = { minCols: 2, maxCols: 500, minRows: 1, maxRows: 300 } as const;
export interface TerminalSize {
  cols: number;
  rows: number;
}
export interface TerminalApi {
  completeTerminalPaths: (
    id: string,
    prefix: string,
  ) => Promise<import('./path-completion.js').PathCompletion[]>;
  onSshChallenge: (listener: (challenge: import('./ssh.js').SshChallenge) => void) => () => void;
  answerSshChallenge: (id: string, token: string, answers: string[]) => void;
  openSshTerminal: (
    id: string,
    size: TerminalSize,
    hostId: string,
    credentials: import('./ssh.js').SshCredentials,
  ) => Promise<void>;
  installSshPublicKey: (hostId: string, password: string) => Promise<void>;
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
