import type { IDisposable, IPty } from 'node-pty';
export type TerminalTransport = Pick<
  IPty,
  'write' | 'resize' | 'kill' | 'onData' | 'pause' | 'resume'
> & {
  executeCommand?: (
    command: string,
    signal: AbortSignal,
  ) => Promise<import('../../shared/batch.js').CommandResult>;
  inspectResume?: (
    record: import('../../shared/transfers.js').TransferRecoveryRecord,
    signal: AbortSignal,
  ) => Promise<import('../../shared/transfers.js').ResumeInspection>;
  recoverPartial?: (
    record: import('../../shared/transfers.js').TransferRecoveryRecord,
    signal: AbortSignal,
    expected?: import('../../shared/transfers.js').PartialInspection,
  ) => Promise<import('../../shared/transfers.js').PartialInspection>;
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
    resume?: import('../files/transfer-file.js').TransferResume,
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
