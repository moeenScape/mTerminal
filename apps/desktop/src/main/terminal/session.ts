import type { TerminalInput } from '../../shared/terminal-input.js';
import type { IPty, IDisposable } from 'node-pty';
import { validTerminalSize, type TerminalEvent, type TerminalSize } from '../../shared/terminal.js';

export const HIGH_WATER = 256 * 1024;
const LOW_WATER = 64 * 1024;
const MAX_BUFFER = 1024 * 1024;
interface Session {
  id: string;
  pty: IPty;
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
    create: (signal: AbortSignal) => Promise<IPty>,
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
        pty.kill();
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
        pty.onExit(({ exitCode }) => {
          if (this.session !== session) return;
          this.flush(session);
          this.release(session, false);
          this.send({ kind: 'exit', id, exitCode });
        }),
      );
    } catch (error) {
      if (started && this.session === started) this.release(started, true);
      throw error;
    } finally {
      if (this.opening === opening) this.opening = undefined;
    }
  }
  private output(session: Session, data: string): void {
    if (this.session !== session) return;
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
  private flush(session: Session): void {
    if (session.timer) clearTimeout(session.timer);
    session.timer = undefined;
    if (!session.queued) return;
    const data = session.queue.join('');
    session.queue = [];
    session.queued = 0;
    session.inFlight += data.length;
    this.send({ kind: 'data', id: session.id, data });
  }
  write(id: string, input: TerminalInput): void {
    if (this.session?.id === id)
      this.session.pty.write(
        input.kind === 'binary' ? Buffer.from(input.data, 'latin1') : input.data,
      );
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
    if (kill) {
      try {
        session.pty.kill();
      } catch {
        /* Already exited. */
      }
    }
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
