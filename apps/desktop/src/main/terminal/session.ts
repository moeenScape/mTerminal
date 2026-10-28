import type { IPty, IDisposable } from 'node-pty';
import type { TerminalEvent, TerminalSize } from '../../shared/terminal.js';

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
  timer: ReturnType<typeof setTimeout> | undefined;
}
export class TerminalSession {
  private session: Session | undefined;
  private opening: string | undefined;
  private disposed = false;
  constructor(private readonly send: (event: TerminalEvent) => void) {}
  async open(id: string, size: TerminalSize, create: () => Promise<IPty>): Promise<void> {
    if (this.disposed || this.session || this.opening)
      throw new Error('A terminal is already open.');
    this.opening = id;
    try {
      const pty = await create();
      if (this.disposed || this.opening !== id) {
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
        timer: undefined,
      };
      this.session = session;
      pty.resize(size.cols, size.rows);
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
      if (this.session?.id === id) this.release(this.session, true);
      throw error;
    } finally {
      if (this.opening === id) this.opening = undefined;
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
  write(id: string, data: string): void {
    if (this.session?.id === id) this.session.pty.write(data);
  }
  resize(id: string, size: TerminalSize): void {
    if (this.session?.id === id) this.session.pty.resize(size.cols, size.rows);
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
    if (this.opening === id) this.opening = undefined;
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
    this.opening = undefined;
    if (this.session) this.release(this.session, true);
  }
  dispose(): void {
    this.disposed = true;
    this.opening = undefined;
    if (this.session) this.release(this.session, true);
  }
}
