import { EventEmitter } from 'node:events';
import type { Client, ClientChannel } from 'ssh2';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeSshCommand } from '../../src/main/terminal/ssh-exec.js';
import { BATCH_OUTPUT_BYTES, BATCH_TIMEOUT_MS } from '../../src/shared/batch.js';
function fixture() {
  const channel = Object.assign(new EventEmitter(), {
    stderr: new EventEmitter(),
    end: vi.fn(),
    destroy: vi.fn(),
  });
  const client = Object.assign(new EventEmitter(), {
    exec: vi.fn(
      (_command: string, callback: (error: Error | undefined, stream: ClientChannel) => void) =>
        callback(undefined, channel as unknown as ClientChannel),
    ),
    destroy: vi.fn(),
  });
  const controller = new AbortController();
  return {
    channel,
    client,
    controller,
    run: () => executeSshCommand(client as unknown as Client, 'hostname', controller.signal),
  };
}
afterEach(() => vi.useRealTimers());
describe('bounded SSH exec channels', () => {
  it('captures UTF-8 stdout/stderr and confirmed exit status without closing the shared client', async () => {
    const { channel, client, run } = fixture();
    const pending = run();
    const text = Buffer.from('বাংলা 😀');
    channel.emit('data', text.subarray(0, 2));
    channel.emit('data', text.subarray(2));
    channel.stderr.emit('data', Buffer.from('warning'));
    channel.emit('exit', 0);
    channel.emit('close');
    expect(await pending).toEqual({
      status: 'succeeded',
      stdout: 'বাংলা 😀',
      stderr: 'warning',
      exitCode: 0,
      exitSignal: null,
    });
    expect(client.exec).toHaveBeenCalledWith('hostname', expect.any(Function));
    expect(client.destroy).not.toHaveBeenCalled();
    expect(client.listenerCount('close')).toBe(0);
    expect(channel.listenerCount('data')).toBe(0);
    expect(channel.end).toHaveBeenCalledOnce();
  });
  it('does not execute an already cancelled command and closes only the active exec channel on cancellation', async () => {
    const stopped = fixture();
    stopped.controller.abort();
    expect((await stopped.run()).status).toBe('cancelled');
    expect(stopped.client.exec).not.toHaveBeenCalled();
    const active = fixture();
    const pending = active.run();
    active.channel.emit('data', Buffer.from('partial'));
    active.controller.abort();
    expect(await pending).toMatchObject({ status: 'cancelled', stdout: 'partial' });
    expect(active.channel.destroy).toHaveBeenCalledOnce();
    expect(active.client.destroy).not.toHaveBeenCalled();
  });
  it('disposes a channel accepted after cancellation and absorbs late close errors', async () => {
    const state = fixture();
    let accepted: ((error: Error | undefined, stream: ClientChannel) => void) | undefined;
    state.client.exec.mockImplementation((_command, callback) => {
      accepted = callback;
    });
    const pending = state.run();
    state.controller.abort();
    expect((await pending).status).toBe('cancelled');
    accepted!(undefined, state.channel as unknown as ClientChannel);
    expect(state.channel.destroy).toHaveBeenCalledOnce();
    expect(() => state.channel.emit('error', new Error('late error'))).not.toThrow();
    expect(() => state.channel.stderr.emit('error', new Error('late stderr error'))).not.toThrow();
    const retry = () =>
      executeSshCommand(
        state.client as unknown as Client,
        'hostname',
        new AbortController().signal,
      );
    expect((await retry()).status).toBe('failed');
    expect(state.client.exec).toHaveBeenCalledOnce();
    state.channel.emit('close');
    const next = retry();
    expect(state.client.exec).toHaveBeenCalledTimes(2);
    accepted!(undefined, state.channel as unknown as ClientChannel);
    state.channel.emit('close');
    await next;
  });
  it('bounds combined output and execution time, retaining partial output', async () => {
    const limited = fixture();
    const pending = limited.run();
    limited.channel.emit('data', Buffer.alloc(10, 65));
    limited.channel.stderr.emit('data', Buffer.alloc(BATCH_OUTPUT_BYTES, 66));
    const result = await pending;
    expect(result.status).toBe('output-limit');
    expect(result.stdout.length + result.stderr.length).toBe(BATCH_OUTPUT_BYTES);
    vi.useFakeTimers();
    const timed = fixture();
    const timeout = timed.run();
    vi.advanceTimersByTime(BATCH_TIMEOUT_MS);
    expect((await timeout).status).toBe('timed-out');
    expect(timed.client.destroy).not.toHaveBeenCalled();
  });
  it('never reports success for disconnection, rejection or a missing exit status', async () => {
    const lost = fixture();
    const pending = lost.run();
    lost.client.emit('close');
    expect((await pending).status).toBe('disconnected');
    const unknown = fixture();
    const result = unknown.run();
    unknown.channel.emit('close');
    expect(await result).toMatchObject({ status: 'failed', exitCode: null });
    const rejected = fixture();
    rejected.client.exec.mockImplementation(() => {
      throw new Error('server error containing private details');
    });
    const failure = await rejected.run();
    expect(failure.status).toBe('failed');
    expect(JSON.stringify(failure)).not.toContain('private details');
  });
});
