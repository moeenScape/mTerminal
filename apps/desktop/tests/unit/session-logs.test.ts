import { afterEach, describe, expect, it, vi } from 'vitest';
import { LogTextStream, SessionLogRecorder } from '../../src/main/terminal/session-logs.js';
import {
  logLineOffset,
  MAX_LOG_CHARACTERS,
  validateLogAnnotation,
} from '../../src/shared/session-logs.js';
const id = '04e9f162-d3cd-4c8f-a70a-2323a1751a9b';
function fixture() {
  let output: (id: string, text: string) => void = () => {},
    closed: (id: string) => void = () => {};
  const unsubscribe = vi.fn();
  const store = {
    saveSessionLog: vi.fn(async (log: import('../../src/shared/session-logs.js').SessionLog) => {
      void log;
    }),
  };
  const terminals = {
    isReady: vi.fn(() => true),
    onOutput: (callback: typeof output) => {
      output = callback;
      return unsubscribe;
    },
    onSessionClosed: (callback: typeof closed) => {
      closed = callback;
      return unsubscribe;
    },
  };
  const recorder = new SessionLogRecorder(terminals, store, vi.fn());
  return {
    recorder,
    store,
    terminals,
    unsubscribe,
    output: (text: string, sessionId = id) => output(sessionId, text),
    close: () => closed(id),
  };
}
afterEach(() => vi.useRealTimers());
describe('output-only text filtering', () => {
  it('strips chunked OSC/CSI/DCS and C1 controls without retaining protocol payloads', () => {
    const data =
      'one\r\n\x1b[31mred\x1b[0m\x1b]777;private;HOME\x07\x1bPpayload\x1b\\\x9dsecret\x9c\x9b32mend\n';
    for (let n = 0; n <= data.length; n++) {
      const stream = new LogTextStream();
      expect(stream.feed(data.slice(0, n)) + stream.feed(data.slice(n))).toBe('one\nredend\n');
    }
    expect(new LogTextStream().feed('\x1b[1;\x1b]metadata\x07safe')).toBe('safe');
    const stream = new LogTextStream();
    expect(stream.feed('\ud83d') + stream.feed('\ude00')).toBe('😀');
    expect(stream.feed('\x1b]incomplete')).toBe('');
    expect(stream.feed('x'.repeat(100000))).toBe('');
    expect(stream.feed('\x07normal')).toBe('normal');
  });
  it('validates annotation bounds and line offsets without accepting renderer output', () => {
    expect(logLineOffset('a\nb\n', 2)).toBe(2);
    expect(() => logLineOffset('a', 2)).toThrow();
    expect(() => logLineOffset('a', 0)).toThrow();
    expect(
      validateLogAnnotation({ notes: '', bookmarks: [{ id, offset: 2, comment: 'Review' }] }, 3),
    ).toMatchObject({ bookmarks: [{ offset: 2 }] });
    for (const value of [
      { notes: '', bookmarks: [{ id, offset: 4, comment: '' }] },
      {
        notes: '',
        bookmarks: [
          { id, offset: 0, comment: '' },
          { id, offset: 1, comment: '' },
        ],
      },
      { notes: '\x1b', bookmarks: [] },
      { notes: '', bookmarks: [], text: 'forged output' },
    ])
      expect(() => validateLogAnnotation(value, 3)).toThrow();
  });
});
describe('main-owned session recording', () => {
  it('captures only approved output, checkpoints and seals without redirecting to another session', async () => {
    vi.useFakeTimers();
    const state = fixture();
    try {
      state.output('before consent');
      expect(state.store.saveSessionLog).not.toHaveBeenCalled();
      await state.recorder.start(id, 'Local');
      await expect(state.recorder.start(id, 'duplicate')).rejects.toThrow();
      state.output('wrong', 'other');
      state.output('one\r\ntwo');
      await vi.advanceTimersByTimeAsync(2000);
      expect(state.store.saveSessionLog.mock.calls.at(-1)?.[0]).toMatchObject({
        text: 'one\ntwo',
        reason: 'checkpoint',
      });
      state.output(' tail');
      await state.recorder.stop();
      expect(state.store.saveSessionLog.mock.calls.at(-1)?.[0]).toMatchObject({
        text: 'one\ntwo tail',
        reason: 'stopped',
      });
      const count = state.store.saveSessionLog.mock.calls.length;
      state.output('after stop');
      expect(state.store.saveSessionLog).toHaveBeenCalledTimes(count);
      expect(state.recorder.state().active).toBeNull();
    } finally {
      await state.recorder.dispose();
    }
  });
  it('bounds capture, closes on disconnect and stops after failed writes without retry', async () => {
    vi.useFakeTimers();
    const state = fixture();
    try {
      await state.recorder.start(id, 'SSH');
      state.output('x'.repeat(MAX_LOG_CHARACTERS + 1));
      await state.recorder.stop();
      expect(state.store.saveSessionLog.mock.calls.at(-1)?.[0]).toMatchObject({
        reason: 'limit',
        text: 'x'.repeat(MAX_LOG_CHARACTERS),
      });
      await state.recorder.start(id, 'Again');
      state.output('last');
      state.close();
      await state.recorder.stop();
      expect(state.store.saveSessionLog.mock.calls.at(-1)?.[0]).toMatchObject({
        reason: 'closed',
        text: 'last',
      });
      await state.recorder.start(id, 'Failure');
      state.store.saveSessionLog.mockRejectedValueOnce(new Error('disk failure with private data'));
      state.output('unsaved');
      await vi.advanceTimersByTimeAsync(2000);
      expect(state.recorder.state()).toMatchObject({
        active: null,
        message: expect.stringContaining('last saved checkpoint'),
      });
      const count = state.store.saveSessionLog.mock.calls.length;
      state.output('never saved');
      await vi.advanceTimersByTimeAsync(4000);
      expect(state.store.saveSessionLog).toHaveBeenCalledTimes(count);
    } finally {
      await state.recorder.dispose();
    }
  });
  it('refuses annotation/deletion while the final checkpoint is pending', async () => {
    const state = fixture();
    try {
      await state.recorder.start(id, 'Local');
      const logId = state.recorder.state().active!.logId;
      let release!: () => void;
      state.store.saveSessionLog.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
      const stop = state.recorder.stop();
      expect(() => state.recorder.assertEditable(logId)).toThrow();
      await Promise.resolve();
      release();
      await stop;
      expect(() => state.recorder.assertEditable(logId)).not.toThrow();
    } finally {
      await state.recorder.dispose();
    }
  });
  it('cancels late starts and refuses suspended/disposed sessions', async () => {
    const state = fixture();
    let release!: () => void;
    state.store.saveSessionLog.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const start = state.recorder.start(id, 'Late');
    await Promise.resolve();
    state.recorder.suspend(true);
    const stop = state.recorder.stop();
    release();
    await expect(start).rejects.toThrow();
    await stop;
    expect(state.recorder.state().active).toBeNull();
    await expect(state.recorder.start(id, 'Locked')).rejects.toThrow();
    state.recorder.suspend(false);
    state.terminals.isReady.mockReturnValue(false);
    await expect(state.recorder.start(id, 'Closed')).rejects.toThrow();
    await state.recorder.dispose();
    expect(state.unsubscribe).toHaveBeenCalledTimes(2);
    await expect(state.recorder.start(id, 'Disposed')).rejects.toThrow();
  });
});
