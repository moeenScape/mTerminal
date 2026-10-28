import { createServer, connect, type Socket } from 'node:net';
import type { TerminalTransport, TerminalExit } from '../../src/main/terminal/transport.js';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { Server, utils, type Connection, type AuthContext } from 'ssh2';
import { describe, expect, it, vi } from 'vitest';
import { openSsh, fingerprintMatches } from '../../src/main/terminal/ssh.js';
import type { SshConnectionState } from '../../src/shared/terminal.js';
import { validateSshCredentials } from '../../src/shared/ssh.js';

const host = {
  name: 'Fixture',
  address: '127.0.0.1',
  port: 22,
  username: 'user',
  protocol: 'ssh' as const,
};
const size = { cols: 80, rows: 24 };
async function fixture(
  operation: (
    port: number,
    fingerprint: string,
    authCount: () => number,
    windows: number[][],
  ) => Promise<void>,
  authenticate?: (context: AuthContext) => void,
) {
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
    type: 'pkcs1',
    format: 'pem',
  });
  const parsed = utils.parseKey(key);
  if (parsed instanceof Error || Array.isArray(parsed)) throw new Error('Fixture key invalid');
  const fingerprint =
    'SHA256:' +
    createHash('sha256').update(parsed.getPublicSSH()).digest('base64').replace(/=+$/, '');
  const connections = new Set<Connection>();
  let authCount = 0;
  const windows: number[][] = [];
  const server = new Server({ hostKeys: [key] }, (connection) => {
    connections.add(connection);
    connection.on('error', () => {});
    connection.on('close', () => connections.delete(connection));
    connection.on('authentication', (context) => {
      authCount++;
      if (authenticate) {
        authenticate(context);
        return;
      }
      if (
        context.method === 'password' &&
        context.username === 'user' &&
        context.password === 'test-password'
      )
        context.accept();
      else context.reject();
    });
    connection.on('ready', () =>
      connection.on('session', (accept) => {
        const session = accept();
        session.on('pty', (accept, _reject, info) => {
          windows.push([info.cols, info.rows]);
          accept?.();
        });
        session.on('window-change', (accept, _reject, info) => {
          windows.push([info.cols, info.rows]);
          accept?.();
        });
        session.on('shell', (accept) => {
          const stream = accept();
          stream.on('data', (data: Buffer) => {
            stream.write(data);
            if (data.toString() === 'exit') {
              stream.exit(0);
              stream.end();
            }
          });
        });
      }),
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture address invalid');
  try {
    await operation(address.port, fingerprint, () => authCount, windows);
  } finally {
    for (const connection of connections) connection.end();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('SSH terminal transport', () => {
  it('validates credentials and verifies exact SHA256 fingerprints', () => {
    expect(fingerprintMatches(Buffer.from('key'), 'SHA256:wrong')).toBe(false);
    expect(() =>
      validateSshCredentials({ username: 'user', password: 'secret', fingerprint: 'unverified' }),
    ).toThrow();
    expect(() =>
      validateSshCredentials({
        username: 'u\0',
        password: '',
        fingerprint: 'SHA256:' + 'a'.repeat(43),
      }),
    ).toThrow();
  });
  it('opens a PTY, streams Unicode input/output, resizes and reports exit', async () => {
    await fixture(async (port, fingerprint, _authCount, windows) => {
      const states: SshConnectionState[] = [];
      const transport = await openSsh(
        { ...host, port },
        { username: 'user', password: 'test-password', fingerprint },
        size,
        new AbortController().signal,
        undefined,
        undefined,
        (state) => states.push(state),
      );
      expect(states).toEqual(['connecting', 'verifying', 'authenticating', 'opening-shell']);
      const data: string[] = [];
      const output = transport.onData((value) => data.push(value));
      const exited = new Promise<number>((resolve) =>
        transport.onExit((event) => resolve(event.exitCode)),
      );
      try {
        transport.resize(100, 40);
        transport.write('বাংলা 😀');
        await expect.poll(() => data.join('')).toContain('বাংলা 😀');
        await expect.poll(() => windows).toContainEqual([100, 40]);
        transport.write('exit');
        expect(await exited).toBe(0);
        expect(data.join('')).toContain('exit');
      } finally {
        output.dispose();
        transport.kill();
      }
    });
  });
  it('rejects a mismatched host key before authentication', async () => {
    await fixture(async (port, _fingerprint, authCount) => {
      await expect(
        openSsh(
          { ...host, port },
          { username: 'user', password: 'test-password', fingerprint: 'SHA256:' + 'a'.repeat(43) },
          size,
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ code: 'ssh-key-mismatch' });
      expect(authCount()).toBe(0);
    });
  });
  it('rejects bad authentication and cancelled starts', async () => {
    await fixture(async (port, fingerprint) => {
      await expect(
        openSsh(
          { ...host, port },
          { username: 'user', password: 'bad', fingerprint },
          size,
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ code: 'ssh-failed' });
      const pendingController = new AbortController();
      const pending = openSsh(
        { ...host, port },
        { username: 'user', password: 'test-password', fingerprint },
        size,
        pendingController.signal,
      );
      pendingController.abort();
      await expect(pending).rejects.toMatchObject({ code: 'ssh-failed' });
      const controller = new AbortController();
      controller.abort();
      await expect(
        openSsh(
          { ...host, port },
          { username: 'user', password: '', fingerprint },
          size,
          controller.signal,
        ),
      ).rejects.toMatchObject({ code: 'ssh-failed' });
    });
  });
  it('authenticates with an encrypted private key and rejects an incorrect passphrase', async () => {
    const key = generateKeyPairSync('rsa', { modulusLength: 2048 })
      .privateKey.export({
        type: 'pkcs1',
        format: 'pem',
        cipher: 'aes-256-cbc',
        passphrase: 'key-passphrase',
      })
      .toString();
    const parsed = utils.parseKey(key, 'key-passphrase');
    if (parsed instanceof Error || Array.isArray(parsed)) throw new Error('Invalid fixture key');
    await fixture(
      async (port, fingerprint) => {
        const credentials = {
          username: 'user',
          method: 'privateKey' as const,
          privateKey: key,
          passphrase: 'key-passphrase',
          fingerprint,
        };
        const transport = await openSsh(
          { ...host, port },
          credentials,
          size,
          new AbortController().signal,
        );
        transport.kill();
        await expect(
          openSsh(
            { ...host, port },
            { ...credentials, passphrase: 'wrong' },
            size,
            new AbortController().signal,
          ),
        ).rejects.toMatchObject({ code: 'ssh-failed' });
      },
      (context) => {
        if (context.method !== 'publickey' || !context.key.data.equals(parsed.getPublicSSH())) {
          context.reject();
          return;
        }
        if (
          !context.signature ||
          (context.blob && parsed.verify(context.blob, context.signature, context.hashAlgo))
        )
          context.accept();
        else context.reject();
      },
    );
  });
  it('answers multiple keyboard-interactive rounds with echo metadata', async () => {
    const questions: { prompts: { prompt: string; echo: boolean }[] }[] = [];
    await fixture(
      async (port, fingerprint) => {
        const transport = await openSsh(
          { ...host, port },
          { username: 'user', method: 'keyboard-interactive', fingerprint },
          size,
          new AbortController().signal,
          async (question) => {
            questions.push(question);
            return questions.length === 1 ? ['123456'] : ['confirm'];
          },
        );
        transport.kill();
        expect(questions.map((q) => q.prompts[0]?.echo)).toEqual([false, true]);
      },
      (context) => {
        if (context.method !== 'keyboard-interactive') {
          context.reject(['keyboard-interactive']);
          return;
        }
        context.prompt([{ prompt: 'OTP', echo: false }], (answers) => {
          if (answers[0] !== '123456') {
            context.reject();
            return;
          }
          context.prompt([{ prompt: 'Confirmation', echo: true }], (answers) => {
            if (answers[0] === 'confirm') context.accept();
            else context.reject();
          });
        });
      },
    );
  });
  it('waits for asynchronous identity verification before authentication', async () => {
    await fixture(async (port, fingerprint, authCount) => {
      await expect(
        openSsh(
          { ...host, port },
          { username: 'user', password: 'test-password', fingerprint: '' },
          size,
          new AbortController().signal,
          undefined,
          async () => {
            expect(authCount()).toBe(0);
            return false;
          },
        ),
      ).rejects.toMatchObject({ code: 'ssh-key-mismatch' });
      expect(authCount()).toBe(0);
      const transport = await openSsh(
        { ...host, port },
        { username: 'user', password: 'test-password', fingerprint: '' },
        size,
        new AbortController().signal,
        undefined,
        async (key) => fingerprintMatches(key, fingerprint),
      );
      transport.kill();
    });
  });
  it('closes a blackholed connection after unanswered keepalive probes', async () => {
    await fixture(async (port, fingerprint) => {
      let blackhole = false;
      const sockets = new Set<Socket>();
      const proxy = createServer((downstream) => {
        const upstream = connect(port, '127.0.0.1');
        sockets.add(downstream);
        sockets.add(upstream);
        downstream.on('error', () => {});
        upstream.on('error', () => {});
        downstream.on('data', (data: Buffer) => {
          if (!blackhole) upstream.write(data);
        });
        upstream.on('data', (data: Buffer) => {
          if (!blackhole) downstream.write(data);
        });
        downstream.on('close', () => upstream.destroy());
        upstream.on('close', () => downstream.destroy());
      });
      await new Promise<void>((resolve, reject) => {
        proxy.once('error', reject);
        proxy.listen(0, '127.0.0.1', resolve);
      });
      let transport: TerminalTransport | undefined;
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      try {
        const address = proxy.address();
        if (!address || typeof address === 'string') throw new Error('Missing proxy address');
        transport = await openSsh(
          { ...host, port: address.port },
          { username: 'user', password: 'test-password', fingerprint },
          size,
          new AbortController().signal,
        );
        const ended = new Promise<TerminalExit>((resolve) => transport!.onExit(resolve));
        blackhole = true;
        await vi.advanceTimersByTimeAsync(60000);
        expect(await ended).toMatchObject({
          connectionState: 'failed',
          failureCode: 'ssh-keepalive-timeout',
        });
      } finally {
        transport?.kill();
        vi.useRealTimers();
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((resolve) => proxy.close(() => resolve()));
      }
    });
  });
});
