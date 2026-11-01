import type { IDisposable, IPty } from 'node-pty';
export type TerminalTransport = Pick<
  IPty,
  'write' | 'resize' | 'kill' | 'onData' | 'pause' | 'resume'
> & {
  onExit: (listener: (event: TerminalExit) => void) => IDisposable;
  listDirectory?: (path: string) => Promise<import('../../shared/files.js').DirectoryListing>;
  mutateDirectory?: (
    path: string,
    operation: import('../../shared/files.js').FileOperation,
  ) => Promise<void>;
};
export interface TerminalExit {
  exitCode: number;
  connectionState?: 'disconnected' | 'failed';
  failureCode?: 'ssh-keepalive-timeout';
}
