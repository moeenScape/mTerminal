import { describe, expect, it, vi } from 'vitest';
import type { IPty } from 'node-pty';
import { TerminalSession, HIGH_WATER, OUTPUT_BATCH } from '../../src/main/terminal/session.js';
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
    destroy: vi.fn(),
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
    destroy: pty.destroy,
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
      vi.advanceTimersByTime(64);
      expect(events).toHaveLength(4);
      expect(
        events.every((event) => event.kind === 'data' && event.data.length <= OUTPUT_BATCH),
      ).toBe(true);
      expect(events.flatMap((event) => (event.kind === 'data' ? [event.data] : [])).join('')).toBe(
        'a'.repeat(HIGH_WATER),
      );
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
  it('yields between bounded batches and drains final output before exit', async () => {
    vi.useFakeTimers();
    const fake = fakePty();
    const events: TerminalEvent[] = [];
    const terminal = new TerminalSession((event) => events.push(event));
    try {
      await terminal.open(id, size, async () => fake.pty);
      const output = '😀বাংলা'.repeat(30000);
      fake.data(output);
      vi.advanceTimersByTime(16);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ kind: 'data' });
      fake.exit(0);
      expect(events.at(-1)).toEqual({ kind: 'exit', id, exitCode: 0 });
      const data = events.flatMap((event) => (event.kind === 'data' ? [event.data] : []));
      expect(data.every((chunk) => chunk.length <= OUTPUT_BATCH)).toBe(true);
      expect(data.join('')).toBe(output);
      vi.runAllTimers();
      expect(events).toHaveLength(data.length + 1);
    } finally {
      terminal.dispose();
      vi.useRealTimers();
    }
  });
  it('aborts startup resources when the transport factory fails', async () => {
    const terminal = new TerminalSession(() => {});
    let signal!: AbortSignal;
    await expect(
      terminal.open(id, size, async (value) => {
        signal = value;
        throw new Error('failed');
      }),
    ).rejects.toThrow('failed');
    expect(signal.aborted).toBe(true);
    terminal.dispose();
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
    expect(fake.destroy).not.toHaveBeenCalled();
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
    expect(fake.destroy).toHaveBeenCalledOnce();
    const next = fakePty();
    await terminal.open(id, size, async () => next.pty);
    terminal.close('stale-id');
    expect(next.destroy).not.toHaveBeenCalled();
    terminal.dispose();
    expect(next.destroy).toHaveBeenCalledOnce();
  });
  it('falls back to the public kill API when PTY destruction fails', async () => {
    const fake = fakePty();
    fake.destroy.mockImplementation(() => {
      throw new Error('close failed');
    });
    const terminal = new TerminalSession(() => {});
    await terminal.open(id, size, async () => fake.pty);
    terminal.close(id);
    expect(fake.destroy).toHaveBeenCalledOnce();
    expect(fake.pty.kill).toHaveBeenCalledOnce();
  });
  it('keeps the latest grid during startup and suppresses duplicate or stale resizes', async () => {
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
    terminal.resize(id, { cols: 100, rows: 30 });
    terminal.resize('stale-id', { cols: 200, rows: 80 });
    terminal.resize(id, { cols: 120, rows: 40 });
    complete(fake.pty);
    await opening;
    expect(fake.pty.resize).toHaveBeenCalledExactlyOnceWith(120, 40);
    terminal.resize(id, { cols: 120, rows: 40 });
    expect(fake.pty.resize).toHaveBeenCalledOnce();
    terminal.resize(id, { cols: 90, rows: 20 });
    expect(fake.pty.resize).toHaveBeenLastCalledWith(90, 20);
    expect(() => terminal.resize(id, { cols: 0, rows: 0 })).toThrow();
    terminal.dispose();
  });
  it('does not attach a late cancelled process even if a new opening reuses its ID', async () => {
    const old = fakePty();
    const current = fakePty();
    const terminal = new TerminalSession(() => {});
    let finishOld!: (pty: IPty) => void;
    const first = terminal.open(
      id,
      size,
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    );
    terminal.close(id);
    await terminal.open(id, { cols: 100, rows: 30 }, async () => current.pty);
    finishOld(old.pty);
    await first;
    expect(old.destroy).toHaveBeenCalledOnce();
    expect(current.destroy).not.toHaveBeenCalled();
    terminal.dispose();
  });
  it('does not close a newer session when a cancelled opening rejects late', async () => {
    const current = fakePty();
    const terminal = new TerminalSession(() => {});
    let rejectOld!: (error: Error) => void;
    const first = terminal.open(
      id,
      size,
      () =>
        new Promise((_resolve, reject) => {
          rejectOld = reject;
        }),
    );
    terminal.close(id);
    await terminal.open(id, size, async () => current.pty);
    rejectOld(new Error('cancelled initialization'));
    await expect(first).rejects.toThrow('cancelled initialization');
    expect(current.destroy).not.toHaveBeenCalled();
    terminal.dispose();
  });
  it('stops an overflowing session rather than growing memory indefinitely', async () => {
    const fake = fakePty();
    const send = vi.fn();
    const terminal = new TerminalSession(send);
    await terminal.open(id, size, async () => fake.pty);
    fake.data('x'.repeat(1024 * 1024 + 1));
    expect(fake.destroy).toHaveBeenCalledOnce();
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
