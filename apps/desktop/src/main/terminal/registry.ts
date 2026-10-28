import type { IPty } from 'node-pty';
import { MAX_TERMINAL_TABS, type TerminalEvent, type TerminalSize } from '../../shared/terminal.js';
import type { TerminalInput } from '../../shared/terminal-input.js';
import { AppFailure } from '../failures.js';
import { TerminalSession } from './session.js';

export class TerminalRegistry {
  private readonly sessions = new Map<string, TerminalSession>();
  private disposed = false;
  constructor(private readonly send: (event: TerminalEvent) => void) {}
  async open(id: string, size: TerminalSize, create: () => Promise<IPty>): Promise<void> {
    if (this.disposed || this.sessions.has(id)) throw new Error('Duplicate or disposed terminal.');
    if (this.sessions.size >= MAX_TERMINAL_TABS) throw new AppFailure('terminal-limit');
    const session = new TerminalSession((event) => {
      if (this.sessions.get(id) !== session) return;
      if (event.kind !== 'data') {
        this.sessions.delete(id);
        session.dispose();
      }
      this.send(event);
    });
    this.sessions.set(id, session);
    try {
      await session.open(id, size, create);
    } catch (error) {
      if (this.sessions.get(id) === session) this.sessions.delete(id);
      session.dispose();
      throw error;
    }
  }
  write(id: string, input: TerminalInput): void {
    this.sessions.get(id)?.write(id, input);
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
  }
  reset(): void {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    for (const session of sessions) session.dispose();
  }
  dispose(): void {
    this.disposed = true;
    this.reset();
  }
}
