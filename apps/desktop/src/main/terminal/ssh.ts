import { createHash } from 'node:crypto';
import { Client } from 'ssh2';
import type { ClientChannel } from 'ssh2';
import type { TerminalTransport } from './transport.js';
import type { HostDraft } from '../../shared/hosts.js';
import type { SshCredentials } from '../../shared/ssh.js';
import type { TerminalSize } from '../../shared/terminal.js';
import { AppFailure } from '../failures.js';

export function fingerprintMatches(key: Buffer, expected: string): boolean {
  return (
    'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '') === expected
  );
}

export function openSsh(
  host: HostDraft,
  credentials: SshCredentials,
  size: TerminalSize,
  signal: AbortSignal,
): Promise<TerminalTransport> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let stream: ClientChannel | undefined;
    let settled = false;
    let ended = false;
    let exitCode = 255;
    let mismatch = false;
    const dataListeners = new Set<(data: string) => void>();
    const exitListeners = new Set<(event: { exitCode: number }) => void>();
    const emit = (data: string) => {
      for (const listener of dataListeners) listener(data);
    };
    const finish = () => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      // A remote close can arrive while backpressure has paused readable output.
      if (stream) {
        for (const readable of [stream, stream.stderr]) {
          let tail: string | null;
          while ((tail = readable.read() as string | null) !== null) emit(tail);
        }
      }
      if (!settled) {
        settled = true;
        reject(new AppFailure(mismatch ? 'ssh-key-mismatch' : 'ssh-failed'));
      } else for (const listener of exitListeners) listener({ exitCode });
      stream?.destroy();
      client.destroy();
    };
    const abort = () => finish();
    const timer = setTimeout(finish, 20000);
    client.on('error', finish).on('close', finish);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      finish();
      return;
    }
    client.once('ready', () => {
      if (ended) return;
      client.shell(
        { term: 'xterm-256color', cols: size.cols, rows: size.rows },
        (error, channel) => {
          if (error || ended) {
            channel?.destroy();
            finish();
            return;
          }
          stream = channel;
          channel.pause();
          channel.stderr.pause();
          channel.setEncoding('utf8');
          channel.stderr.setEncoding('utf8');
          channel.on('data', emit);
          channel.stderr.on('data', emit);
          channel.on('error', finish);
          channel.stderr.on('error', finish);
          channel.on('exit', (code: number | null) => {
            exitCode = typeof code === 'number' ? code : 255;
          });
          channel.on('close', finish);
          clearTimeout(timer);
          settled = true;
          resolve({
            write: (data) => {
              if (!ended) channel.write(data);
            },
            resize: (cols, rows) => {
              if (!ended) channel.setWindow(rows, cols, 0, 0);
            },
            pause: () => {
              channel.pause();
              channel.stderr.pause();
            },
            resume: () => {
              channel.resume();
              channel.stderr.resume();
            },
            kill: finish,
            onData: (listener) => {
              dataListeners.add(listener);
              channel.resume();
              channel.stderr.resume();
              return {
                dispose: () => {
                  dataListeners.delete(listener);
                },
              };
            },
            onExit: (listener) => {
              exitListeners.add(listener);
              if (ended)
                queueMicrotask(() => {
                  if (exitListeners.has(listener)) listener({ exitCode });
                });
              return {
                dispose: () => {
                  exitListeners.delete(listener);
                },
              };
            },
          });
        },
      );
    });
    try {
      client.connect({
        host: host.address,
        port: host.port,
        username: credentials.username,
        password: credentials.password,
        readyTimeout: 15000,
        hostVerifier: (key: Buffer) => {
          const match = fingerprintMatches(key, credentials.fingerprint);
          if (!match) mismatch = true;
          return match;
        },
      });
    } catch {
      finish();
    }
  });
}
