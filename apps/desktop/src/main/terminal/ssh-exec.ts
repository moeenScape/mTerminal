import { StringDecoder } from 'node:string_decoder';
import type { Client, ClientChannel } from 'ssh2';
import {
  BATCH_OUTPUT_BYTES,
  BATCH_TIMEOUT_MS,
  type CommandResult,
  type ExecutionStatus,
} from '../../shared/batch.js';
const ignoreError = () => {};
// Cancelled requests can still await a server acknowledgement; bound them per client.
const executing = new WeakSet<Client>();
/** Owns one non-interactive exec channel; never closes the shared SSH client. */
export function executeSshCommand(
  client: Client,
  command: string,
  signal: AbortSignal,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    let stream: ClientChannel | undefined;
    let settled = false;
    let exitCode: number | null = null;
    let exitSignal: string | null = null;
    let bytes = 0;
    const out = new StringDecoder('utf8'),
      err = new StringDecoder('utf8');
    const stdout: string[] = [],
      stderr: string[] = [];
    const finish = (status: ExecutionStatus) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      client.off('close', disconnected);
      if (stream) {
        stream.off('data', output);
        stream.stderr.off('data', errorOutput);
        stream.off('close', closed);
        stream.off('error', failed);
        stream.stderr.off('error', failed);
        stream.off('exit', exited);
        stream.on('error', ignoreError);
        stream.stderr.on('error', ignoreError);
        stream.destroy();
      }
      stdout.push(out.end());
      stderr.push(err.end());
      resolve({ status, stdout: stdout.join(''), stderr: stderr.join(''), exitCode, exitSignal });
    };
    const abort = () => finish('cancelled');
    const disconnected = () => finish('disconnected');
    const failed = () => finish('failed');
    const closed = () => finish(exitCode === 0 && !exitSignal ? 'succeeded' : 'failed');
    const exited = (code: number | null, signal?: string) => {
      exitCode = Number.isSafeInteger(code) ? code : null;
      exitSignal = typeof signal === 'string' ? signal.slice(0, 64) : null;
    };
    const consume = (data: Buffer | string, decoder: StringDecoder, chunks: string[]) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
      const available = Math.max(0, BATCH_OUTPUT_BYTES - bytes);
      const taken = buffer.subarray(0, available);
      chunks.push(decoder.write(taken));
      bytes += taken.length;
      if (buffer.length > available) finish('output-limit');
    };
    const output = (data: Buffer | string) => consume(data, out, stdout);
    const errorOutput = (data: Buffer | string) => consume(data, err, stderr);
    const timer = setTimeout(() => finish('timed-out'), BATCH_TIMEOUT_MS);
    signal.addEventListener('abort', abort, { once: true });
    client.once('close', disconnected);
    if (signal.aborted) {
      abort();
      return;
    }
    if (executing.has(client)) {
      failed();
      return;
    }
    executing.add(client);
    const release = () => {
      executing.delete(client);
      client.off('close', release);
    };
    client.once('close', release);
    try {
      client.exec(command, (error, channel) => {
        if (channel) channel.once('close', release);
        else release();
        if (settled || error) {
          channel?.on('error', ignoreError);
          channel?.stderr.on('error', ignoreError);
          channel?.destroy();
          if (!settled) failed();
          return;
        }
        stream = channel;
        channel.on('data', output).on('error', failed).on('exit', exited).on('close', closed);
        channel.stderr.on('data', errorOutput).on('error', failed);
        channel.end();
      });
    } catch {
      if (!stream) release();
      failed();
    }
  });
}
