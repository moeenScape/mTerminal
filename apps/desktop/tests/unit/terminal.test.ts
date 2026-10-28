import { describe, expect, it, vi } from 'vitest';
import type { IPty } from 'node-pty';
import { TerminalSession, HIGH_WATER } from '../../src/main/terminal/session.js';
import {
  validTerminalId,
  validTerminalSize,
  type TerminalEvent,
} from '../../src/shared/terminal.js';

const id = '12345678-1234-4123-8123-123456789abc';
const size = { cols: 80, rows: 24 };
function fakePty() {
  let data: (value: string) => void = () => {};
  let exit: (event: { exitCode: number }) => void = () => {};
  const disposeData = vi.fn();
  const disposeExit = vi.fn();
  const pty = {
    kill: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    onData: vi.fn((callback: typeof data) => {
      data = callback;
      return { dispose: disposeData };
    }),
    onExit: vi.fn((callback: typeof exit) => {
      exit = callback;
      return { dispose: disposeExit };
    }),
  };
  return {
    pty: pty as unknown as IPty,
    data: (value: string) => data(value),
    exit: (exitCode: number) => exit({ exitCode }),
    disposeData,
    disposeExit,
  };
}

describe('local terminal lifecycle', () => {
  it('batches output, applies backpressure, and resumes after rendering acknowledges data', async () => {
    vi.useFakeTimers();
    const fake = fakePty();
    const events: TerminalEvent[] = [];
    const terminal = new TerminalSession((event) => events.push(event));
    try {
      await terminal.open(id, size, async () => fake.pty);
      fake.data('a'.repeat(HIGH_WATER));
      expect(fake.pty.pause).toHaveBeenCalledOnce();
      expect(events).toEqual([]);
      vi.advanceTimersByTime(16);
      expect(events).toEqual([{ kind: 'data', id, data: 'a'.repeat(HIGH_WATER) }]);
      expect(() => terminal.ack(id, HIGH_WATER + 1)).toThrow();
      terminal.ack(id, HIGH_WATER);
      expect(fake.pty.resume).toHaveBeenCalledOnce();
      terminal.write('another-id', { kind: 'text', data: 'ignored' });
      expect(fake.pty.write).not.toHaveBeenCalled();
      terminal.write(id, { kind: 'text', data: 'echo hello\r' });
      expect(fake.pty.write).toHaveBeenCalledWith('echo hello\r');
      terminal.resize(id, { cols: 100, rows: 40 });
      expect(fake.pty.resize).toHaveBeenLastCalledWith(100, 40);
    } finally {
      terminal.dispose();
      vi.useRealTimers();
    }
  });
  it('writes text controls unchanged and preserves eight-bit binary input', async () => {
    const fake = fakePty();
    const terminal = new TerminalSession(() => {});
    await terminal.open(id, size, async () => fake.pty);
    try {
      const text = 'বাংলা 中文 😀 e\u0301\x03\t\x1b[A\x7f\r';
      terminal.write(id, { kind: 'text', data: text });
      expect(fake.pty.write).toHaveBeenLastCalledWith(text);
      terminal.write(id, { kind: 'binary', data: '\x00\x7f\x80\xff' });
      expect(fake.pty.write).toHaveBeenLastCalledWith(Buffer.from([0, 127, 128, 255]));
    } finally {
      terminal.dispose();
    }
  });
  it('preserves Unicode and escape sequences across output batches', async () => {
    vi.useFakeTimers();
    const fake = fakePty();
    const events: TerminalEvent[] = [];
    const terminal = new TerminalSession((event) => events.push(event));
    try {
      await terminal.open(id, size, async () => fake.pty);
      const chunks = ['\x1b[3', '1mবাংলা 中文 😀', '\x1b[0m\r\ne\u0301'];
      for (const chunk of chunks) {
        fake.data(chunk);
        vi.advanceTimersByTime(16);
      }
      expect(events.flatMap((event) => (event.kind === 'data' ? [event.data] : [])).join('')).toBe(
        chunks.join(''),
      );
    } finally {
      terminal.dispose();
      vi.useRealTimers();
    }
  });
  it('flushes final output before exit and disposes listeners', async () => {
    const fake = fakePty();
    const events: TerminalEvent[] = [];
    const terminal = new TerminalSession((event) => events.push(event));
    await terminal.open(id, size, async () => fake.pty);
    fake.data('goodbye');
    fake.exit(0);
    expect(events).toEqual([
      { kind: 'data', id, data: 'goodbye' },
      { kind: 'exit', id, exitCode: 0 },
    ]);
    expect(fake.disposeData).toHaveBeenCalledOnce();
    expect(fake.disposeExit).toHaveBeenCalledOnce();
    terminal.dispose();
    expect(fake.pty.kill).not.toHaveBeenCalled();
  });
  it('kills a process created after cancellation and allows later sessions', async () => {
    const fake = fakePty();
    const terminal = new TerminalSession(() => {});
    let complete!: (pty: IPty) => void;
    const opening = terminal.open(
      id,
      size,
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    terminal.reset();
    complete(fake.pty);
    await opening;
    expect(fake.pty.kill).toHaveBeenCalledOnce();
    const next = fakePty();
    await terminal.open(id, size, async () => next.pty);
    terminal.close('stale-id');
    expect(next.pty.kill).not.toHaveBeenCalled();
    terminal.dispose();
    expect(next.pty.kill).toHaveBeenCalledOnce();
  });
  it('stops an overflowing session rather than growing memory indefinitely', async () => {
    const fake = fakePty();
    const send = vi.fn();
    const terminal = new TerminalSession(send);
    await terminal.open(id, size, async () => fake.pty);
    fake.data('x'.repeat(1024 * 1024 + 1));
    expect(fake.pty.kill).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({ kind: 'error', id, code: 'terminal-overflow' });
    terminal.dispose();
  });
});

describe('terminal request validation', () => {
  it('accepts bounded grid sizes and opaque UUID session identifiers', () => {
    expect(validTerminalId(id)).toBe(true);
    expect(validTerminalSize(size)).toBe(true);
    for (const invalid of [
      null,
      {},
      { cols: 0, rows: 20 },
      { cols: 80, rows: 1.2 },
      { cols: 501, rows: 24 },
    ])
      expect(validTerminalSize(invalid)).toBe(false);
    for (const invalid of [null, '', '../shell', 'x'.repeat(10000)])
      expect(validTerminalId(invalid)).toBe(false);
  });
});
