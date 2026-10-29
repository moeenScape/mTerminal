import { createHash } from 'node:crypto';
import { Client, type ClientChannel } from '../ssh2-module.js';
import type { TerminalTransport, TerminalExit } from './transport.js';
import type { HostDraft } from '../../shared/hosts.js';
import { validateSshQuestion, type SshQuestion, type SshCredentials } from '../../shared/ssh.js';
import type { TerminalSize, SshConnectionState } from '../../shared/terminal.js';
import { AppFailure } from '../failures.js';

export function keyFingerprint(key: Buffer): string {
  return 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
}
export function fingerprintMatches(key: Buffer, expected: string): boolean {
  return keyFingerprint(key) === expected;
}

export function openSsh(
  host: HostDraft,
  credentials: SshCredentials,
  size: TerminalSize,
  signal: AbortSignal,
  ask?: (question: SshQuestion) => Promise<string[]>,
  verifyKey?: (key: Buffer) => Promise<boolean>,
  report?: (state: SshConnectionState) => void,
): Promise<TerminalTransport> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let stream: ClientChannel | undefined;
    let settled = false;
    let ended = false;
    let exitCode = 255;
    let mismatch = false;
    let failed = false;
    let failureCode: TerminalExit['failureCode'];
    let lastState: SshConnectionState | undefined;
    const progress = (state: SshConnectionState) => {
      if (!ended && !settled && lastState !== state) {
        lastState = state;
        report?.(state);
      }
    };
    const outcome = (): TerminalExit => ({
      exitCode,
      connectionState: failed ? 'failed' : 'disconnected',
      ...(failureCode ? { failureCode } : {}),
    });
    const dataListeners = new Set<(data: string) => void>();
    const exitListeners = new Set<(event: TerminalExit) => void>();
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
        reject(
          new AppFailure(
            signal.aborted ? 'ssh-cancelled' : mismatch ? 'ssh-key-mismatch' : 'ssh-failed',
          ),
        );
      } else for (const listener of exitListeners) listener(outcome());
      stream?.destroy();
      client.destroy();
    };
    const fail = (error?: unknown) => {
      if (!ended) {
        if (
          settled &&
          error &&
          typeof error === 'object' &&
          'level' in error &&
          error.level === 'client-timeout'
        )
          failureCode = 'ssh-keepalive-timeout';
        failed = true;
        finish();
      }
    };
    const abort = () => finish();
    const interactive =
      credentials.method === 'keyboard-interactive' || credentials.keyboardInteractive === true;
    const humanVerification = interactive || !!verifyKey;
    const timer = setTimeout(finish, humanVerification ? 120000 : 20000);
    client.on('error', fail).on('close', finish);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      finish();
      return;
    }
    client.on('keyboard-interactive', (title, instructions, _language, prompts, respond) => {
      if (ended || !ask) {
        finish();
        return;
      }
      progress('authenticating');
      try {
        const question = validateSshQuestion({
          title,
          instructions,
          prompts: prompts.map((p) => ({ prompt: p.prompt, echo: p.echo === true })),
        });
        void ask(question)
          .then((answers) => {
            if (!ended) respond(answers);
          })
          .catch(finish);
      } catch {
        finish();
      }
    });
    client.once('ready', () => {
      if (ended) return;
      progress('opening-shell');
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
          channel.on('error', fail);
          channel.stderr.on('error', fail);
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
                  if (exitListeners.has(listener)) listener(outcome());
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
      progress('connecting');
      client.connect({
        host: host.address,
        port: host.port,
        username: credentials.username,
        keepaliveInterval: 15000,
        keepaliveCountMax: 3,
        ...(credentials.method === 'privateKey'
          ? { privateKey: credentials.privateKey!, passphrase: credentials.passphrase! }
          : credentials.method === 'keyboard-interactive'
            ? {}
            : { password: credentials.password! }),
        tryKeyboard: interactive,
        authHandler:
          credentials.method === 'keyboard-interactive'
            ? ['keyboard-interactive']
            : credentials.method === 'privateKey'
              ? interactive
                ? ['publickey', 'keyboard-interactive']
                : ['publickey']
              : interactive
                ? ['password', 'keyboard-interactive']
                : ['password'],
        readyTimeout: humanVerification ? 120000 : 15000,
        hostVerifier: (key: Buffer, verify: (accepted: boolean) => void) => {
          progress('verifying');
          if (verifyKey) {
            void verifyKey(key)
              .then((accepted) => {
                if (!ended) {
                  mismatch = !accepted;
                  if (accepted) progress('authenticating');
                  verify(accepted);
                }
              })
              .catch(() => {
                if (!ended) {
                  mismatch = true;
                  verify(false);
                }
              });
          } else {
            const match = fingerprintMatches(key, credentials.fingerprint);
            if (!match) mismatch = true;
            else progress('authenticating');
            verify(match);
          }
        },
      });
    } catch {
      finish();
    }
  });
}
