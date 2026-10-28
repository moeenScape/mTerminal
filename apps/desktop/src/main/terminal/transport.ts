import type { IDisposable, IPty } from 'node-pty';
export type TerminalTransport = Pick<
  IPty,
  'write' | 'resize' | 'kill' | 'onData' | 'pause' | 'resume'
> & { onExit: (listener: (event: TerminalExit) => void) => IDisposable };
export interface TerminalExit {
  exitCode: number;
  connectionState?: 'disconnected' | 'failed';
}
