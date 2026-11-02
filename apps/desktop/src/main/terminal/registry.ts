import type { TerminalTransport } from './transport.js';
import {
  MAX_TERMINAL_TABS,
  type TerminalEvent,
  type TerminalSize,
  type SshConnectionState,
} from '../../shared/terminal.js';
import type { TerminalInput } from '../../shared/terminal-input.js';
import { AppFailure } from '../failures.js';
import { TerminalSession } from './session.js';
import { FileBrowserError } from '../files/listing.js';

export class TerminalRegistry {
  private readonly sessions = new Map<string, TerminalSession>();
  private disposed = false;
  private suspended = false;
  private readonly closedListeners = new Set<(id: string) => void>();
  onSessionClosed(listener: (id: string) => void): () => void {
    this.closedListeners.add(listener);
    return () => {
      this.closedListeners.delete(listener);
    };
  }
  private notifyClosed(id: string): void {
    for (const listener of this.closedListeners) listener(id);
  }
  canTransfer(id: string): boolean {
    return !this.disposed && !!this.sessions.get(id)?.canTransfer;
  }
  async prepareRemoteEdit(
    request: import('../../shared/remote-edit.js').RemoteEditRequest,
    directory: string,
    signal: AbortSignal,
  ) {
    const session = this.sessions.get(request.sessionId);
    if (!session) throw new FileBrowserError('disconnected');
    return session.prepareRemoteEdit(request, directory, signal);
  }
  async transferFile(
    id: string,
    request: import('../../shared/transfers.js').TransferRequest,
    signal: AbortSignal,
    progress: (transferred: number, total: number) => void,
    approval?: import('../../shared/transfers.js').TransferConflictPreview,
  ) {
    const session = this.sessions.get(id);
    if (!session) throw new FileBrowserError('disconnected');
    return session.transferFile(request, signal, progress, approval);
  }
  get count(): number {
    return this.sessions.size;
  }
  suspend(value: boolean): void {
    this.suspended = value;
  }
  constructor(private readonly send: (event: TerminalEvent) => void) {}
  async open(
    id: string,
    size: TerminalSize,
    create: (
      signal: AbortSignal,
      report: (state: SshConnectionState) => void,
    ) => Promise<TerminalTransport>,
  ): Promise<void> {
    if (this.disposed || this.suspended || this.sessions.has(id))
      throw new Error('Duplicate or disposed terminal.');
    if (this.sessions.size >= MAX_TERMINAL_TABS) throw new AppFailure('terminal-limit');
    const session = new TerminalSession((event) => {
      if (this.sessions.get(id) !== session) return;
      if (event.kind === 'exit' || event.kind === 'error') {
        this.sessions.delete(id);
        session.dispose();
        this.notifyClosed(id);
      }
      this.send(event);
    });
    this.sessions.set(id, session);
    try {
      await session.open(id, size, (signal) =>
        create(signal, (state) => {
          if (!signal.aborted && this.sessions.get(id) === session)
            this.send({ kind: 'state', id, state });
        }),
      );
    } catch (error) {
      if (this.sessions.get(id) === session) this.sessions.delete(id);
      session.dispose();
      throw error;
    }
  }
  write(id: string, input: TerminalInput): void {
    this.sessions.get(id)?.write(id, input);
  }
  async listDirectory(id: string, path: string) {
    const session = this.sessions.get(id);
    if (!session) throw new FileBrowserError('disconnected');
    return session.listDirectory(path);
  }
  async mutateDirectory(
    id: string,
    path: string,
    operation: import('../../shared/files.js').FileOperation,
  ) {
    const session = this.sessions.get(id);
    if (!session) throw new FileBrowserError('disconnected');
    return session.mutateDirectory(path, operation);
  }
  resize(id: string, size: TerminalSize): void {
    this.sessions.get(id)?.resize(id, size);
  }
  ack(id: string, count: number): void {
    this.sessions.get(id)?.ack(id, count);
  }
  close(id: string): void {
    const session = this.sessions.get(id);
    this.sessions.delete(id);
    session?.dispose();
    if (session) this.notifyClosed(id);
  }
  reset(): void {
    const sessions = [...this.sessions.entries()];
    this.sessions.clear();
    for (const [id, session] of sessions) {
      session.dispose();
      this.notifyClosed(id);
    }
  }
  dispose(): void {
    this.disposed = true;
    this.reset();
  }
}
