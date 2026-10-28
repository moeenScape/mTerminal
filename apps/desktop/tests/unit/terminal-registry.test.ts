import { describe, expect, it, vi } from 'vitest';
import type { IPty } from 'node-pty';
import { TerminalRegistry } from '../../src/main/terminal/registry.js';
import { MAX_TERMINAL_TABS } from '../../src/shared/terminal.js';

function fakePty() {
  let exit: (event: { exitCode: number }) => void = () => {};
  const process = {
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    onData: () => ({ dispose: vi.fn() }),
    onExit: (callback: typeof exit) => {
      exit = callback;
      return { dispose: vi.fn() };
    },
  };
  return { pty: process as unknown as IPty, exit: () => exit({ exitCode: 0 }) };
}
const size = { cols: 80, rows: 24 };
describe('owned terminal registry', () => {
  it('isolates input, resizing, and closure across sessions', async () => {
    const one = fakePty();
    const two = fakePty();
    const registry = new TerminalRegistry(() => {});
    await registry.open('one', size, async () => one.pty);
    await registry.open('two', size, async () => two.pty);
    registry.write('one', { kind: 'text', data: 'echo one\r' });
    registry.resize('two', { cols: 100, rows: 40 });
    expect(one.pty.write).toHaveBeenCalledWith('echo one\r');
    expect(two.pty.write).not.toHaveBeenCalled();
    expect(two.pty.resize).toHaveBeenLastCalledWith(100, 40);
    expect(one.pty.resize).toHaveBeenCalledOnce();
    registry.close('one');
    expect(one.pty.kill).toHaveBeenCalledOnce();
    expect(two.pty.kill).not.toHaveBeenCalled();
    registry.dispose();
    expect(two.pty.kill).toHaveBeenCalledOnce();
  });
  it('rejects duplicate IDs and releases slots on exit', async () => {
    const process = fakePty();
    const send = vi.fn();
    const registry = new TerminalRegistry(send);
    await registry.open('one', size, async () => process.pty);
    await expect(registry.open('one', size, async () => fakePty().pty)).rejects.toThrow(
      'Duplicate',
    );
    expect(process.pty.kill).not.toHaveBeenCalled();
    process.exit();
    expect(send).toHaveBeenCalledWith({ kind: 'exit', id: 'one', exitCode: 0 });
    const replacement = fakePty();
    await registry.open('one', size, async () => replacement.pty);
    registry.dispose();
    expect(replacement.pty.kill).toHaveBeenCalledOnce();
  });
  it('enforces the session cap and cleans every process on reset', async () => {
    const registry = new TerminalRegistry(() => {});
    const processes = Array.from({ length: MAX_TERMINAL_TABS }, fakePty);
    for (let index = 0; index < processes.length; index++)
      await registry.open(String(index), size, async () => processes[index]!.pty);
    const create = vi.fn(async () => fakePty().pty);
    await expect(registry.open('overflow', size, create)).rejects.toMatchObject({
      code: 'terminal-limit',
    });
    expect(create).not.toHaveBeenCalled();
    registry.reset();
    expect(processes.every((process) => vi.mocked(process.pty.kill).mock.calls.length === 1)).toBe(
      true,
    );
    await registry.open('again', size, create);
    registry.dispose();
  });
  it('kills a late-created process after its tab closes without affecting another tab', async () => {
    const registry = new TerminalRegistry(() => {});
    const late = fakePty();
    const current = fakePty();
    let finish!: (pty: IPty) => void;
    const opening = registry.open(
      'old',
      size,
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    registry.close('old');
    await registry.open('new', size, async () => current.pty);
    finish(late.pty);
    await opening;
    expect(late.pty.kill).toHaveBeenCalledOnce();
    expect(current.pty.kill).not.toHaveBeenCalled();
    registry.dispose();
  });
});
