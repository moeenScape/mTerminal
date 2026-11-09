import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandBatch } from '../../src/main/terminal/batch.js';
import {
  validateBatchRequest,
  type BatchTarget,
  type CommandResult,
} from '../../src/shared/batch.js';
const success: CommandResult = {
  status: 'succeeded',
  stdout: 'ok',
  stderr: '',
  exitCode: 0,
  exitSignal: null,
};
function fixture(count = 4) {
  let targets: BatchTarget[] = Array.from({ length: count }, (_, index) => ({
    sessionId: randomUUID(),
    address: `host-${index}.internal`,
    port: 22,
    username: 'deploy',
    fingerprint: `SHA256:${'a'.repeat(43)}`,
  }));
  const pending = new Map<string, (result: CommandResult) => void>();
  const executeCommand = vi.fn(
    (id: string, _command: string, signal: AbortSignal) =>
      new Promise<CommandResult>((resolve) => {
        pending.set(id, resolve);
        signal.addEventListener(
          'abort',
          () => resolve({ ...success, status: 'cancelled', exitCode: null }),
          { once: true },
        );
      }),
  );
  const batch = new CommandBatch({ executionTargets: () => targets, executeCommand }, vi.fn());
  return {
    batch,
    executeCommand,
    pending,
    targets: () => targets,
    change: (value: BatchTarget[]) => {
      targets = value;
    },
    prepare: () =>
      batch.prepare({ command: 'hostname', sessionIds: targets.map((target) => target.sessionId) }),
  };
}
afterEach(() => vi.useRealTimers());
describe('reviewed multiple-host execution', () => {
  it('makes preparation side-effect free, bounds concurrency and records independent failures', async () => {
    const state = fixture();
    const preview = state.prepare();
    expect(state.executeCommand).not.toHaveBeenCalled();
    state.batch.start(preview.token);
    expect(state.executeCommand).toHaveBeenCalledTimes(3);
    state.pending.get(state.targets()[0]!.sessionId)!({
      ...success,
      status: 'failed',
      exitCode: 1,
      stderr: 'failed',
    });
    await Promise.resolve();
    expect(state.executeCommand).toHaveBeenCalledTimes(4);
    for (const target of state.targets().slice(1)) state.pending.get(target.sessionId)!(success);
    await vi.waitFor(() => expect(state.batch.state()?.finished).toBe(true));
    expect(state.batch.state()?.results.map((row) => row.status)).toEqual([
      'failed',
      'succeeded',
      'succeeded',
      'succeeded',
    ]);
    expect(() => state.batch.start(preview.token)).toThrow();
  });
  it('refuses changed, expired and duplicate destinations before any execution', () => {
    const state = fixture(2);
    const preview = state.prepare();
    state.change([{ ...state.targets()[0]!, username: 'other-user' }, state.targets()[1]!]);
    expect(() => state.batch.start(preview.token)).toThrow();
    expect(state.executeCommand).not.toHaveBeenCalled();
    vi.useFakeTimers();
    const fresh = state.prepare();
    vi.advanceTimersByTime(60001);
    expect(() => state.batch.start(fresh.token)).toThrow();
    expect(() =>
      validateBatchRequest({
        command: 'echo ok',
        sessionIds: [fresh.targets[0]!.sessionId, fresh.targets[0]!.sessionId],
      }),
    ).toThrow();
    expect(() =>
      validateBatchRequest({ command: 'echo\x1b[201~', sessionIds: [fresh.targets[0]!.sessionId] }),
    ).toThrow();
  });
  it('cancels queued/running commands without replacing completed results or replaying', async () => {
    const state = fixture(5);
    const job = state.batch.start(state.prepare().token);
    state.pending.get(state.targets()[0]!.sessionId)!(success);
    await Promise.resolve();
    state.batch.cancel(job.id);
    await vi.waitFor(() => expect(state.batch.state()?.finished).toBe(true));
    expect(state.executeCommand).toHaveBeenCalledTimes(4);
    expect(state.batch.state()?.results.map((row) => row.status)).toEqual([
      'succeeded',
      'cancelled',
      'cancelled',
      'cancelled',
      'cancelled',
    ]);
    expect(() => state.batch.start(job.id)).toThrow();
  });
  it('does not redirect a queued command to a replacement SSH connection', async () => {
    const state = fixture();
    state.batch.start(state.prepare().token);
    state.change([
      ...state.targets().slice(0, 3),
      { ...state.targets()[3]!, sessionId: randomUUID() },
    ]);
    for (const target of state.targets().slice(0, 3)) state.pending.get(target.sessionId)!(success);
    await vi.waitFor(() => expect(state.batch.state()?.finished).toBe(true));
    expect(state.executeCommand).toHaveBeenCalledTimes(3);
    expect(state.batch.state()?.results[3]?.status).toBe('disconnected');
  });
  it('deduplicates equivalent connected accounts and resets safely during execution', async () => {
    const state = fixture(1);
    state.change([...state.targets(), { ...state.targets()[0]!, sessionId: randomUUID() }]);
    expect(state.batch.targets()).toHaveLength(1);
    const preview = state.batch.prepare({
      command: 'echo ok',
      sessionIds: [state.batch.targets()[0]!.sessionId],
    });
    state.batch.start(preview.token);
    state.batch.reset();
    await Promise.resolve();
    expect(state.batch.state()).toBeNull();
    expect(state.executeCommand).toHaveBeenCalledOnce();
  });
});
