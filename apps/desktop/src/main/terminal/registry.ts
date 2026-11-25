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
  private readonly guestWriters = new Map<string, symbol>();
  private suspended = false;
  private readonly outputListeners = new Set<(id: string, data: string) => void>();
  onOutput(listener: (id: string, data: string) => void) {
    this.outputListeners.add(listener);
    return () => {
      this.outputListeners.delete(listener);
    };
  }
  isReady(id: string) {
    return !this.disposed && !this.suspended && this.sessions.get(id)?.ready === true;
  }
  liveSessions(): { id: string; label: string }[] {
    return [...this.sessions].flatMap(([id, session], index) =>
      this.isReady(id)
        ? [
            {
              id,
              label: [`Terminal ${index + 1}`, session.transferPeer?.address]
                .filter(Boolean)
                .join(' · '),
            },
          ]
        : [],
    );
  }
  private readonly closedListeners = new Set<(id: string) => void>();
  onSessionClosed(listener: (id: string) => void): () => void {
    this.closedListeners.add(listener);
    return () => {
      this.closedListeners.delete(listener);
    };
  }
  private notifyClosed(id: string): void {
    this.guestWriters.delete(id);
    for (const listener of this.closedListeners) listener(id);
  }
  executionTargets(): import('../../shared/batch.js').BatchTarget[] {
    if (this.disposed || this.suspended) return [];
    return [...this.sessions.entries()].flatMap(([sessionId, session]) =>
      !this.guestWriters.has(sessionId) && session.canExecute && session.transferPeer
        ? [{ sessionId, ...session.transferPeer }]
        : [],
    );
  }
  executeCommand(id: string, command: string, signal: AbortSignal) {
    const session = this.sessions.get(id);
    if (this.disposed || this.suspended || this.guestWriters.has(id) || !session?.canExecute)
      throw new Error('SSH session unavailable.');
    return session.executeCommand(command, signal);
  }
  sendBreak(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (this.disposed || this.suspended || this.guestWriters.has(id) || !session)
      return Promise.reject(new Error('Serial session unavailable.'));
    return session.sendBreak();
  }
  canForward(id: string): boolean {
    return !this.disposed && !this.suspended && !!this.sessions.get(id)?.canForward;
  }
  startForward(
    id: string,
    rule: import('../../shared/port-forwarding.js').PortForwardDraft,
    events: import('./port-forward.js').ForwardEvents,
  ) {
    const session = this.sessions.get(id);
    if (this.disposed || this.suspended || !session?.canForward)
      throw new Error('SSH session unavailable.');
    return session.startForward(rule, events);
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
  async inspectResume(
    id: string,
    record: import('../../shared/transfers.js').TransferRecoveryRecord,
    signal: AbortSignal,
  ) {
    const session = this.sessions.get(id);
    if (!session) throw new FileBrowserError('disconnected');
    return session.inspectResume(record, signal);
  }
  async recoverPartial(
    id: string,
    record: import('../../shared/transfers.js').TransferRecoveryRecord,
    signal: AbortSignal,
    expected?: import('../../shared/transfers.js').PartialInspection,
  ) {
    const session = this.sessions.get(id);
    if (!session) throw new FileBrowserError('disconnected');
    return session.recoverPartial(record, signal, expected);
  }
  transferPeer(id: string) {
    return this.sessions.get(id)?.transferPeer ?? null;
  }
  async transferFile(
    id: string,
    request: import('../../shared/transfers.js').TransferRequest,
    signal: AbortSignal,
    progress: (transferred: number, total: number) => void,
    approval?: import('../../shared/transfers.js').TransferConflictPreview,
    checkpoint?: (value: import('../../shared/transfers.js').TransferCheckpoint) => void,
    resume?: import('../files/transfer-file.js').TransferResume,
  ) {
    const session = this.sessions.get(id);
    if (!session) throw new FileBrowserError('disconnected');
    return session.transferFile(request, signal, progress, approval, checkpoint, resume);
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
      if (event.kind === 'data')
        for (const listener of this.outputListeners) listener(id, event.data);
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
  async completePaths(id: string, prefix: string) {
    const session = this.sessions.get(id);
    if (this.disposed || this.suspended || !session) return [];
    const result = await session.completePaths(prefix);
    return !this.disposed && !this.suspended && this.sessions.get(id) === session ? result : [];
  }
  acquireGuestWriter(id: string) {
    if (!this.isReady(id) || this.guestWriters.has(id)) return undefined;
    const lease = Symbol();
    this.guestWriters.set(id, lease);
    return {
      write: (input: TerminalInput) => {
        if (!this.isReady(id) || this.guestWriters.get(id) !== lease)
          throw new Error('Guest input is no longer available.');
        this.sessions.get(id)!.write(id, input);
      },
      release: () => {
        if (this.guestWriters.get(id) === lease) this.guestWriters.delete(id);
      },
    };
  }
  write(id: string, input: TerminalInput): void {
    if (!this.guestWriters.has(id)) this.sessions.get(id)?.write(id, input);
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
