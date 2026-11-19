import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { utils } from '../../src/main/ssh2-module.js';
import { agentStatus, findAgent } from '../../src/main/terminal/agent.js';
import { sshAuthConfig } from '../../src/main/terminal/ssh.js';
import { savedJumpCredentials } from '../../src/main/terminal/jump.js';
import { LocalDatabase } from '../../src/main/storage/database.js';
import type { SshSecretStore } from '../../src/main/storage/secret-store.js';
import { validateSshCredentials } from '../../src/shared/ssh.js';
import { validateHost } from '../../src/shared/hosts.js';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'mterminal-agent-'));
  cleanups.push(() => rm(path, { recursive: true, force: true }));
  return path;
}
function stringField(value: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(value.length);
  return Buffer.concat([length, value]);
}
/** Minimal OpenSSH agent answering REQUEST_IDENTITIES (11) with IDENTITIES_ANSWER (12). */
async function fakeAgent(path: string, keys: { blob: Buffer; comment: string }[]) {
  const server: Server = createServer((socket) => {
    socket.on('data', (data: Buffer) => {
      if (data[4] !== 11) return;
      const count = Buffer.alloc(4);
      count.writeUInt32BE(keys.length);
      const body = Buffer.concat([
        Buffer.from([12]),
        count,
        ...keys.flatMap((key) => [stringField(key.blob), stringField(Buffer.from(key.comment))]),
      ]);
      const length = Buffer.alloc(4);
      length.writeUInt32BE(body.length);
      socket.write(Buffer.concat([length, body]));
    });
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
}

describe('agent discovery', () => {
  it('uses SSH_AUTH_SOCK only when it names a socket', async () => {
    const dir = await directory();
    const socket = join(dir, 'agent.sock');
    await fakeAgent(socket, []);
    const file = join(dir, 'plain');
    await writeFile(file, '');
    expect(await findAgent({ SSH_AUTH_SOCK: socket }, 'linux')).toEqual({
      path: socket,
      source: 'socket',
    });
    expect(await findAgent({ SSH_AUTH_SOCK: file }, 'linux')).toBeUndefined();
    expect(await findAgent({ SSH_AUTH_SOCK: 'relative.sock' }, 'darwin')).toBeUndefined();
    expect(await findAgent({}, 'linux')).toBeUndefined();
  });
  it('prefers a named OpenSSH pipe on Windows and otherwise falls back to Pageant', async () => {
    expect(await findAgent({ SSH_AUTH_SOCK: '\\\\.\\pipe\\openssh-ssh-agent' }, 'win32')).toEqual({
      path: '\\\\.\\pipe\\openssh-ssh-agent',
      source: 'pipe',
    });
    expect(await findAgent({}, 'win32')).toEqual({ path: 'pageant', source: 'pageant' });
  });
  it('lists public keys with fingerprints and reports missing agents', async () => {
    const dir = await directory();
    const socket = join(dir, 'agent.sock');
    const pair = utils.generateKeyPairSync('ed25519', { comment: 'me@pc' });
    const parsed = utils.parseKey(pair.public);
    if (parsed instanceof Error || Array.isArray(parsed)) throw new Error('Key parse failed.');
    await fakeAgent(socket, [{ blob: parsed.getPublicSSH(), comment: 'me@pc' }]);
    const status = await agentStatus({ SSH_AUTH_SOCK: socket }, 'linux');
    expect(status).toMatchObject({ available: true, source: 'socket' });
    if (!status.available) throw new Error('Agent unavailable.');
    expect(status.keys).toHaveLength(1);
    expect(status.keys[0]).toMatchObject({ type: 'ssh-ed25519', comment: 'me@pc' });
    expect(status.keys[0]!.fingerprint).toMatch(/^SHA256:/);
    expect(await agentStatus({}, 'linux')).toEqual({ available: false, reason: 'missing' });
  });
});

describe('agent sign-in options', () => {
  it('accepts the agent method and builds agent authentication', () => {
    const credentials = validateSshCredentials({ username: 'u', fingerprint: '', method: 'agent' });
    expect(credentials).toMatchObject({ method: 'agent', username: 'u' });
    expect(sshAuthConfig(credentials, '/tmp/agent.sock')).toEqual({
      username: 'u',
      agent: '/tmp/agent.sock',
      tryKeyboard: false,
      authHandler: ['agent'],
    });
    expect(
      sshAuthConfig({ ...credentials, keyboardInteractive: true }, '/tmp/agent.sock').authHandler,
    ).toEqual(['agent', 'keyboard-interactive']);
    // Forwarding with a password login still needs the agent path.
    expect(
      sshAuthConfig(
        { username: 'u', method: 'password', password: 'p', fingerprint: '' },
        '/tmp/agent.sock',
      ),
    ).toMatchObject({ password: 'p', agent: '/tmp/agent.sock', authHandler: ['password'] });
  });
  it('stores agent settings on hosts and uses the agent for jump hops', async () => {
    const draft = {
      name: 'SSH',
      address: 'ssh.internal',
      port: 22,
      username: 'ops',
      protocol: 'ssh' as const,
    };
    expect(validateHost({ ...draft, useAgent: true, agentForwarding: true })).toMatchObject({
      useAgent: true,
      agentForwarding: true,
    });
    expect(validateHost({ ...draft, useAgent: false })).not.toHaveProperty('useAgent');
    expect(() => validateHost({ ...draft, useAgent: 'yes' })).toThrow();
    const dir = await directory();
    const database = await LocalDatabase.open(join(dir, 'data.sqlite'));
    cleanups.push(() => database.close());
    const host = database.saveHost({ ...draft, useAgent: true, agentForwarding: true });
    expect(database.listHosts()).toEqual([host]);
    const noSecrets = {
      getLogin: () => Promise.resolve(undefined),
      getPrivateKey: () => Promise.resolve(undefined),
    } as unknown as SshSecretStore;
    await expect(savedJumpCredentials(host, database, noSecrets)).resolves.toMatchObject({
      method: 'agent',
      username: 'ops',
    });
  });
});
