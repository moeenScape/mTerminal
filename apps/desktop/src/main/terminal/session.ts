import type { TerminalInput } from '../../shared/terminal-input.js';
import type { IDisposable } from 'node-pty';
import type { TerminalTransport } from './transport.js';
import { validTerminalSize, type TerminalEvent, type TerminalSize } from '../../shared/terminal.js';
import { FileBrowserError } from '../files/listing.js';

export const HIGH_WATER = 256 * 1024;
export const OUTPUT_BATCH = 64 * 1024;
const LOW_WATER = 64 * 1024;
const MAX_BUFFER = 1024 * 1024;

function closePty(pty: TerminalTransport): void {
  // shortcut: node-pty 1.1 exposes destroy at runtime but omits it from public typings; review on upgrade.
  const destroy = (pty as TerminalTransport & { destroy?: () => void }).destroy;
  if (typeof destroy === 'function') {
    try {
      destroy.call(pty);
      return;
    } catch {
      // Try the public API if closing the PTY failed.
    }
  }
  try {
    pty.kill();
  } catch {
    // The process may already have exited.
  }
}

interface Session {
  id: string;
  pty: TerminalTransport;
  listeners: IDisposable[];
  queue: string[];
  queued: number;
  inFlight: number;
  paused: boolean;
  size: TerminalSize;
  timer: ReturnType<typeof setTimeout> | undefined;
}
export class TerminalSession {
  private session: Session | undefined;
  private opening: { id: string; size: TerminalSize; controller: AbortController } | undefined;
  private disposed = false;
  constructor(private readonly send: (event: TerminalEvent) => void) {}
  async open(
    id: string,
    size: TerminalSize,
    create: (signal: AbortSignal) => Promise<TerminalTransport>,
  ): Promise<void> {
    if (this.disposed || this.session || this.opening)
      throw new Error('A terminal is already open.');
    if (!validTerminalSize(size)) throw new Error('Invalid terminal size.');
    const opening = { id, size: { ...size }, controller: new AbortController() };
    this.opening = opening;
    let started: Session | undefined;
    try {
      const pty = await create(opening.controller.signal);
      if (this.disposed || this.opening !== opening) {
        closePty(pty);
        return;
      }
      const session: Session = {
        id,
        pty,
        listeners: [],
        queue: [],
        queued: 0,
        inFlight: 0,
        paused: false,
        size: { ...opening.size },
        timer: undefined,
      };
      started = session;
      this.session = session;
      pty.resize(session.size.cols, session.size.rows);
      session.listeners.push(pty.onData((data) => this.output(session, data)));
      session.listeners.push(
        pty.onExit(({ exitCode, connectionState, failureCode }) => {
          if (this.session !== session) return;
          this.flush(session, true);
          this.release(session, false);
          this.send({
            kind: 'exit',
            id,
            exitCode,
            ...(connectionState ? { connectionState } : {}),
            ...(failureCode ? { failureCode } : {}),
          });
        }),
      );
    } catch (error) {
      opening.controller.abort();
      if (started && this.session === started) this.release(started, true);
      throw error;
    } finally {
      if (this.opening === opening) this.opening = undefined;
    }
  }
  private output(session: Session, data: string): void {
    if (this.session !== session || !data.length) return;
    if (session.queued + session.inFlight + data.length > MAX_BUFFER) {
      this.release(session, true);
      this.send({ kind: 'error', id: session.id, code: 'terminal-overflow' });
      return;
    }
    session.queue.push(data);
    session.queued += data.length;
    if (!session.timer) session.timer = setTimeout(() => this.flush(session), 16);
    if (!session.paused && session.queued + session.inFlight >= HIGH_WATER) {
      session.paused = true;
      session.pty.pause();
    }
  }
  private flush(session: Session, drain = false): void {
    if (session.timer) clearTimeout(session.timer);
    session.timer = undefined;
    if (this.session !== session) return;
    do {
      const chunks: string[] = [];
      let remaining = OUTPUT_BATCH;
      let consumed = 0;
      while (remaining > 0 && consumed < session.queue.length) {
        const head = session.queue[consumed]!;
        let count = Math.min(remaining, head.length);
        // Keep surrogate pairs together when a batch ends inside a string.
        const last = head.charCodeAt(count - 1);
        if (count < head.length && last >= 0xd800 && last <= 0xdbff) count--;
        if (!count) break;
        chunks.push(head.slice(0, count));
        if (count === head.length) consumed++;
        else session.queue[consumed] = head.slice(count);
        remaining -= count;
      }
      if (consumed) session.queue = session.queue.slice(consumed);
      const data = chunks.join('');
      if (!data.length) break;
      session.queued -= data.length;
      session.inFlight += data.length;
      this.send({ kind: 'data', id: session.id, data });
    } while (drain && session.queued);
    if (session.queued && this.session === session)
      session.timer = setTimeout(() => this.flush(session), 16);
  }
  write(id: string, input: TerminalInput): void {
    if (this.session?.id === id)
      this.session.pty.write(
        input.kind === 'binary' ? Buffer.from(input.data, 'latin1') : input.data,
      );
  }
  async listDirectory(path: string) {
    if (!this.session?.pty.listDirectory) throw new FileBrowserError('disconnected');
    return this.session.pty.listDirectory(path);
  }
  async recoverPartial(
    record: import('../../shared/transfers.js').TransferRecoveryRecord,
    signal: AbortSignal,
    expected?: import('../../shared/transfers.js').PartialInspection,
  ) {
    if (!this.session?.pty.recoverPartial) throw new FileBrowserError('disconnected');
    return this.session.pty.recoverPartial(record, signal, expected);
  }
  get transferPeer() {
    return this.session?.pty.transferPeer ?? null;
  }
  get canTransfer(): boolean {
    return !!this.session?.pty.transferFile;
  }
  async prepareRemoteEdit(
    request: import('../../shared/remote-edit.js').RemoteEditRequest,
    directory: string,
    signal: AbortSignal,
  ) {
    if (!this.session?.pty.prepareRemoteEdit) throw new FileBrowserError('disconnected');
    return this.session.pty.prepareRemoteEdit(request, directory, signal);
  }
  async transferFile(
    request: import('../../shared/transfers.js').TransferRequest,
    signal: AbortSignal,
    progress: (transferred: number, total: number) => void,
    approval?: import('../../shared/transfers.js').TransferConflictPreview,
    checkpoint?: (value: import('../../shared/transfers.js').TransferCheckpoint) => void,
  ) {
    if (!this.session?.pty.transferFile) throw new FileBrowserError('disconnected');
    return this.session.pty.transferFile(request, signal, progress, approval, checkpoint);
  }
  async mutateDirectory(path: string, operation: import('../../shared/files.js').FileOperation) {
    if (!this.session?.pty.mutateDirectory) throw new FileBrowserError('disconnected');
    return this.session.pty.mutateDirectory(path, operation);
  }
  resize(id: string, size: TerminalSize): void {
    if (!validTerminalSize(size)) throw new Error('Invalid terminal size.');
    if (this.opening?.id === id) this.opening.size = { ...size };
    const session = this.session;
    if (
      !session ||
      session.id !== id ||
      (session.size.cols === size.cols && session.size.rows === size.rows)
    )
      return;
    session.pty.resize(size.cols, size.rows);
    session.size = { ...size };
  }
  ack(id: string, count: number): void {
    const session = this.session;
    if (!session || session.id !== id) return;
    if (count > session.inFlight) throw new Error('Invalid output acknowledgement.');
    session.inFlight -= count;
    if (session.paused && session.inFlight + session.queued < LOW_WATER) {
      session.paused = false;
      session.pty.resume();
    }
  }
  close(id: string): void {
    if (this.opening?.id === id) {
      this.opening.controller.abort();
      this.opening = undefined;
    }
    if (this.session?.id === id) this.release(this.session, true);
  }
  private release(session: Session, kill: boolean): void {
    this.session = undefined;
    if (session.timer) clearTimeout(session.timer);
    for (const listener of session.listeners) listener.dispose();
    session.queue = [];
    if (kill) closePty(session.pty);
  }
  reset(): void {
    this.opening?.controller.abort();
    this.opening = undefined;
    if (this.session) this.release(this.session, true);
  }
  dispose(): void {
    this.disposed = true;
    this.opening?.controller.abort();
    this.opening = undefined;
    if (this.session) this.release(this.session, true);
  }
}
