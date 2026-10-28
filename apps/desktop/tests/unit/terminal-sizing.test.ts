import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalSizing } from '../../src/renderer/src/features/workspace/terminal-sizing.js';
import type { TerminalSize } from '../../src/shared/terminal.js';

let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
beforeEach(() => {
  frames = new Map();
  nextFrame = 1;
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    }),
  );
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((id: number) => frames.delete(id)),
  );
});
afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const host = { clientWidth: 800, clientHeight: 600 };
  const terminal = {
    cols: 80,
    rows: 24,
    resize: vi.fn((cols: number, rows: number) => {
      terminal.cols = cols;
      terminal.rows = rows;
    }),
  };
  const measure = vi.fn<() => TerminalSize | undefined>(() => ({ cols: 100, rows: 30 }));
  const publish = vi.fn();
  const sizing = new TerminalSizing(host, terminal, measure, publish);
  return { host, terminal, measure, publish, sizing };
}
function renderFrame() {
  const pending = [...frames.values()];
  frames.clear();
  for (const callback of pending) callback(0);
}

describe('synchronized terminal sizing', () => {
  it('coalesces repeated notifications and publishes only a changed grid', () => {
    const { sizing, measure, publish, terminal } = fixture();
    sizing.schedule();
    sizing.schedule();
    sizing.schedule();
    expect(frames.size).toBe(1);
    expect(measure).not.toHaveBeenCalled();
    renderFrame();
    expect(terminal.resize).toHaveBeenCalledWith(100, 30);
    expect(publish).toHaveBeenCalledWith({ cols: 100, rows: 30 });
    sizing.schedule();
    renderFrame();
    expect(publish).toHaveBeenCalledOnce();
    expect(terminal.resize).toHaveBeenCalledOnce();
    sizing.dispose();
  });
  it('caps the emulator and PTY publication at the exact same dimensions', () => {
    const { sizing, measure, terminal, publish } = fixture();
    measure.mockReturnValue({ cols: 900, rows: 900 });
    expect(sizing.fitNow()).toEqual({ cols: 500, rows: 300 });
    expect(terminal.cols).toBe(500);
    expect(terminal.rows).toBe(300);
    expect(publish).toHaveBeenLastCalledWith({ cols: 500, rows: 300 });
    measure.mockReturnValue({ cols: 81.8, rows: 25.4 });
    expect(sizing.fitNow()).toEqual({ cols: 81, rows: 25 });
    sizing.dispose();
  });
  it('preserves the previous size while hidden or unmeasurable, then catches up when shown', () => {
    const { sizing, host, measure, publish } = fixture();
    host.clientWidth = 0;
    expect(sizing.fitNow()).toBeUndefined();
    expect(measure).not.toHaveBeenCalled();
    host.clientWidth = 800;
    for (const invalid of [
      undefined,
      { cols: NaN, rows: 10 },
      { cols: 80, rows: 0 },
      { cols: Infinity, rows: 20 },
    ]) {
      measure.mockReturnValue(invalid);
      expect(sizing.fitNow()).toBeUndefined();
    }
    expect(publish).not.toHaveBeenCalled();
    measure.mockReturnValue({ cols: 120, rows: 40 });
    sizing.schedule();
    renderFrame();
    expect(publish).toHaveBeenCalledWith({ cols: 120, rows: 40 });
    sizing.dispose();
  });
  it('can resynchronize a newly opened PTY and cancels late callbacks after disposal', () => {
    const { sizing, publish, measure } = fixture();
    sizing.fitNow();
    sizing.fitNow(true);
    expect(publish).toHaveBeenCalledTimes(2);
    sizing.schedule();
    const late = [...frames.values()][0]!;
    sizing.dispose();
    late(0);
    sizing.schedule();
    expect(frames.size).toBe(0);
    expect(measure).toHaveBeenCalledTimes(2);
  });
});
