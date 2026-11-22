import { validateEnvironment } from '../../shared/environment.js';
import { executeSshCommand } from './ssh-exec.js';
import { startForward } from './port-forward.js';
import { createHash } from 'node:crypto';
import type { Duplex } from 'node:stream';
import type { AuthenticationType, ConnectConfig } from 'ssh2';
import { Client, isSshKeyExchangeFailure, type ClientChannel } from '../ssh2-module.js';
import type { TerminalTransport, TerminalExit } from './transport.js';
import type { HostDraft } from '../../shared/hosts.js';
import { validateSshQuestion, type SshQuestion, type SshCredentials } from '../../shared/ssh.js';
import type { TerminalSize, SshConnectionState } from '../../shared/terminal.js';
import { AppFailure } from '../failures.js';
import { RemoteFileBrowser } from '../files/remote.js';
import type { FailureCode } from '../../shared/failures.js';

export function keyFingerprint(key: Buffer): string {
  return 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
}
export function fingerprintMatches(key: Buffer, expected: string): boolean {
  return keyFingerprint(key) === expected;
}

/** Username and authentication options shared by direct and jump-host connections. */
export function sshAuthConfig(
  credentials: SshCredentials,
  /** System agent path; required for `agent` sign-in and for agent forwarding. */
  agent?: string,
): Pick<
  ConnectConfig,
  'username' | 'password' | 'privateKey' | 'passphrase' | 'agent' | 'tryKeyboard' | 'authHandler'
> {
  const interactive =
    credentials.method === 'keyboard-interactive' || credentials.keyboardInteractive === true;
  const primary: Record<NonNullable<SshCredentials['method']>, AuthenticationType> = {
    password: 'password',
    privateKey: 'publickey',
    agent: 'agent',
    'keyboard-interactive': 'keyboard-interactive',
  };
  const method = credentials.method ?? 'password';
  return {
    username: credentials.username,
    ...(method === 'privateKey'
      ? { privateKey: credentials.privateKey!, passphrase: credentials.passphrase! }
      : method === 'password'
        ? { password: credentials.password! }
        : {}),
    ...(agent ? { agent } : {}),
    tryKeyboard: interactive,
    authHandler:
      method === 'keyboard-interactive' || !interactive
        ? [primary[method]]
        : [primary[method], 'keyboard-interactive'],
  };
}

/** An already-open tunnel to the target, e.g. through jump hosts; closed with the session. */
export interface SshVia {
  sock: Duplex;
  close: () => void;
}

export function openSsh(
  host: HostDraft,
  credentials: SshCredentials,
  size: TerminalSize,
  signal: AbortSignal,
  ask?: (question: SshQuestion) => Promise<string[]>,
  verifyKey?: (key: Buffer) => Promise<boolean>,
  report?: (state: SshConnectionState) => void,
  via?: SshVia,
  /** System agent path, when signing in with the agent or forwarding it. */
  agent?: string,
): Promise<TerminalTransport> {
  return new Promise((resolve, reject) => {
    const environment = Object.fromEntries(
      validateEnvironment(host.environment).map(({ name, value }) => [name, value]),
    );
    const client = new Client();
    const files = new RemoteFileBrowser(client);
    let stream: ClientChannel | undefined;
    let settled = false;
    let ended = false;
    let exitCode = 255;
    let fingerprint = '';
    let mismatch = false;
    let setupFailure: FailureCode = 'ssh-failed';
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
      files.dispose();
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
            signal.aborted ? 'ssh-cancelled' : mismatch ? 'ssh-key-mismatch' : setupFailure,
          ),
        );
      } else for (const listener of exitListeners) listener(outcome());
      stream?.destroy();
      client.destroy();
      via?.close();
    };
    const fail = (error?: unknown) => {
      if (!ended) {
        const level =
          error && typeof error === 'object' && 'level' in error ? error.level : undefined;
        if (isSshKeyExchangeFailure(error)) {
          if (settled) failureCode = 'ssh-key-exchange-failed';
          else setupFailure = 'ssh-key-exchange-failed';
        } else if (!settled && level === 'client-authentication') {
          setupFailure = 'ssh-auth-failed';
        } else if (settled && level === 'client-timeout') {
          failureCode = 'ssh-keepalive-timeout';
        }
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
        { env: environment },
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
            executeCommand: (command, signal) =>
              executeSshCommand(client, command, signal, environment),
            inspectResume: (record, signal) => files.inspectResume(record, signal),
            recoverPartial: (record, signal, expected) =>
              files.recoverPartial(record, signal, expected),
            transferPeer: {
              address: host.address,
              port: host.port,
              username: credentials.username,
              fingerprint,
            },
            startForward: (rule, events) => startForward(client, rule, events),
            listDirectory: (path) => files.list(path),
            prepareRemoteEdit: (request, directory, signal) =>
              files.prepareEdit(request, directory, signal),
            transferFile: (request, signal, progress, approval, checkpoint, resume) =>
              files.transfer(request, signal, progress, approval, checkpoint, resume),
            mutateDirectory: (path, operation) => files.mutate(path, operation),
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
        ...(via ? { sock: via.sock } : {}),
        keepaliveInterval: 15000,
        keepaliveCountMax: 3,
        ...sshAuthConfig(credentials, agent),
        ...(agent && host.agentForwarding ? { agentForward: true } : {}),
        readyTimeout: humanVerification ? 120000 : 15000,
        hostVerifier: (key: Buffer, verify: (accepted: boolean) => void) => {
          progress('verifying');
          if (verifyKey) {
            void verifyKey(key)
              .then((accepted) => {
                if (!ended) {
                  mismatch = !accepted;
                  if (accepted) {
                    fingerprint = keyFingerprint(key);
                    progress('authenticating');
                  }
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
            else {
              fingerprint = keyFingerprint(key);
              progress('authenticating');
            }
            verify(match);
          }
        },
      });
    } catch (error) {
      fail(error);
    }
  });
}
