import type { IDisposable, IPty } from 'node-pty';
export type TerminalTransport = Pick<
  IPty,
  'write' | 'resize' | 'kill' | 'onData' | 'pause' | 'resume'
> & {
  transferPeer?: import('../../shared/transfers.js').TransferPeer;
  onExit: (listener: (event: TerminalExit) => void) => IDisposable;
  listDirectory?: (path: string) => Promise<import('../../shared/files.js').DirectoryListing>;
  prepareRemoteEdit?: (
    request: import('../../shared/remote-edit.js').RemoteEditRequest,
    directory: string,
    signal: AbortSignal,
  ) => Promise<import('../files/transfer-file.js').TransferOutcome>;
  transferFile?: (
    request: import('../../shared/transfers.js').TransferRequest,
    signal: AbortSignal,
    progress: (transferred: number, total: number) => void,
    approval?: import('../../shared/transfers.js').TransferConflictPreview,
    checkpoint?: (value: import('../../shared/transfers.js').TransferCheckpoint) => void,
  ) => Promise<import('../files/transfer-file.js').TransferOutcome>;
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
