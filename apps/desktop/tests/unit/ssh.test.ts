import { generateKeyPairSync, createHash } from 'node:crypto';
import { Server, utils, type Connection } from 'ssh2';
import { describe, expect, it } from 'vitest';
import { openSsh, fingerprintMatches } from '../../src/main/terminal/ssh.js';
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
      const transport = await openSsh(
        { ...host, port },
        { username: 'user', password: 'test-password', fingerprint },
        size,
        new AbortController().signal,
      );
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
});
