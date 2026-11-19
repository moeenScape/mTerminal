import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { describeProxy, validateProxy, MAX_PROXIES } from '../../src/shared/proxies.js';
import { connectThroughProxy, expandIPv6 } from '../../src/main/terminal/proxy.js';
import { LocalDatabase } from '../../src/main/storage/database.js';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** A one-shot proxy: `handshake` answers the client, then the socket echoes. */
async function fakeProxy(handshake: (socket: Socket, data: Buffer[]) => Promise<boolean>) {
  const received: Buffer[] = [];
  const server = createServer((socket) => {
    socket.on('error', () => {});
    void handshake(socket, received).then((ok) => {
      if (ok) socket.pipe(socket);
      else socket.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  return { port: typeof address === 'object' && address ? address.port : 0, received };
}
function next(socket: Socket, received: Buffer[]): Promise<Buffer> {
  return new Promise((resolve) =>
    socket.once('data', (chunk: Buffer) => {
      received.push(chunk);
      resolve(chunk);
    }),
  );
}
async function echoes(socket: Socket, text: string) {
  socket.resume();
  const reply = new Promise<string>((resolve) =>
    socket.once('data', (chunk: Buffer) => resolve(chunk.toString())),
  );
  socket.write(text);
  expect(await reply).toBe(text);
  socket.destroy();
}
const target = { address: 'ssh.internal', port: 22 };
const signal = () => new AbortController().signal;

describe('proxy records', () => {
  it('validates and describes proxies', () => {
    expect(
      validateProxy({ name: '', type: 'http', address: '[::1]', port: 3128, username: ' u ' }),
    ).toEqual({ name: '::1', type: 'http', address: '::1', port: 3128, username: 'u' });
    expect(
      describeProxy({ name: 'x', type: 'socks5', address: '::1', port: 1080, username: '' }),
    ).toBe('SOCKS5 [::1]:1080');
    for (const bad of [
      { name: '', type: 'ftp', address: 'p', port: 1, username: '' },
      { name: '', type: 'http', address: '', port: 1, username: '' },
      { name: '', type: 'http', address: '-p', port: 1, username: '' },
      { name: '', type: 'http', address: 'p q', port: 1, username: '' },
      { name: '', type: 'http', address: 'p', port: 0, username: '' },
      { name: '', type: 'http', address: 'p', port: 1, username: 'a\nb' },
      { name: '', type: 'http', address: 'p', port: 1, username: '', password: 'x' },
    ])
      expect(() => validateProxy(bad)).toThrow();
  });
  it('expands IPv6 addresses for SOCKS5', () => {
    expect(expandIPv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(expandIPv6('fe80::1:2')).toEqual([0xfe80, 0, 0, 0, 0, 0, 1, 2]);
  });
});

describe('proxy handshakes', () => {
  it('connects through SOCKS5 with username/password authentication', async () => {
    const proxy = await fakeProxy(async (socket, received) => {
      const greeting = await next(socket, received);
      if (!greeting.includes(0x02)) return false;
      socket.write(Buffer.from([5, 2]));
      const auth = await next(socket, received);
      socket.write(Buffer.from([1, auth.includes(Buffer.from('secret')) ? 0 : 1]));
      await next(socket, received);
      socket.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
      return true;
    });
    const socket = await connectThroughProxy(
      { name: 'p', type: 'socks5', address: '127.0.0.1', port: proxy.port, username: 'me' },
      'secret',
      target,
      signal(),
    );
    const request = proxy.received[2]!;
    expect([...request.subarray(0, 5)]).toEqual([5, 1, 0, 3, target.address.length]);
    expect(request.subarray(5, 5 + target.address.length).toString()).toBe(target.address);
    await echoes(socket, 'SSH-2.0-test');
  });
  it('reports a rejected SOCKS5 login and a refused SOCKS5 connection', async () => {
    const auth = await fakeProxy(async (socket, received) => {
      await next(socket, received);
      socket.write(Buffer.from([5, 2]));
      await next(socket, received);
      socket.write(Buffer.from([1, 1]));
      return false;
    });
    await expect(
      connectThroughProxy(
        { name: 'p', type: 'socks5', address: '127.0.0.1', port: auth.port, username: 'me' },
        'wrong',
        target,
        signal(),
      ),
    ).rejects.toMatchObject({ code: 'ssh-proxy-auth-failed' });
    const refused = await fakeProxy(async (socket, received) => {
      await next(socket, received);
      socket.write(Buffer.from([5, 0]));
      await next(socket, received);
      socket.write(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0]));
      return false;
    });
    await expect(
      connectThroughProxy(
        { name: 'p', type: 'socks5', address: '127.0.0.1', port: refused.port, username: '' },
        undefined,
        target,
        signal(),
      ),
    ).rejects.toMatchObject({ code: 'ssh-proxy-refused' });
  });
  it('uses SOCKS4a for host names', async () => {
    const proxy = await fakeProxy(async (socket, received) => {
      await next(socket, received);
      socket.write(Buffer.from([0, 0x5a, 0, 0, 0, 0, 0, 0]));
      return true;
    });
    const socket = await connectThroughProxy(
      { name: 'p', type: 'socks4', address: '127.0.0.1', port: proxy.port, username: 'id' },
      undefined,
      target,
      signal(),
    );
    const request = proxy.received[0]!;
    expect([...request.subarray(0, 8)]).toEqual([4, 1, 0, 22, 0, 0, 0, 1]);
    expect(request.subarray(8).toString('latin1')).toBe(`id\0${target.address}\0`);
    await echoes(socket, 'after-socks4');
  });
  it('tunnels with HTTP CONNECT, keeping bytes sent right after the response', async () => {
    const proxy = await fakeProxy(async (socket, received) => {
      const request = (await next(socket, received)).toString();
      if (
        !request.includes('Proxy-Authorization: Basic ' + Buffer.from('me:pw').toString('base64'))
      )
        return false;
      socket.write('HTTP/1.1 200 Connection established\r\n\r\nSSH-2.0-early');
      return true;
    });
    const socket = await connectThroughProxy(
      { name: 'p', type: 'http', address: '127.0.0.1', port: proxy.port, username: 'me' },
      'pw',
      target,
      signal(),
    );
    expect(proxy.received[0]!.toString()).toMatch(/^CONNECT ssh\.internal:22 HTTP\/1\.1\r\n/);
    const early = await new Promise<string>((resolve) =>
      socket.once('data', (chunk: Buffer) => resolve(chunk.toString())),
    );
    expect(early).toBe('SSH-2.0-early');
    socket.destroy();
  });
  it('maps HTTP 407 to a login failure and an unreachable proxy to a connection failure', async () => {
    const proxy = await fakeProxy(async (socket, received) => {
      await next(socket, received);
      socket.write('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n');
      return false;
    });
    await expect(
      connectThroughProxy(
        { name: 'p', type: 'http', address: '127.0.0.1', port: proxy.port, username: '' },
        undefined,
        target,
        signal(),
      ),
    ).rejects.toMatchObject({ code: 'ssh-proxy-auth-failed' });
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const address = closed.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    await expect(
      connectThroughProxy(
        { name: 'p', type: 'http', address: '127.0.0.1', port, username: '' },
        undefined,
        target,
        signal(),
      ),
    ).rejects.toMatchObject({ code: 'ssh-proxy-failed' });
  });
  it('cancels a pending proxy connection', async () => {
    const proxy = await fakeProxy(() => new Promise<boolean>(() => {}));
    const controller = new AbortController();
    const pending = connectThroughProxy(
      { name: 'p', type: 'socks5', address: '127.0.0.1', port: proxy.port, username: '' },
      undefined,
      target,
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'ssh-cancelled' });
  });
});

describe('proxy storage', () => {
  it('saves proxies, links hosts and clears links when a proxy is deleted', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mterminal-proxies-'));
    const database = await LocalDatabase.open(join(directory, 'data.sqlite'));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    cleanups.push(() => database.close());
    const proxy = database.saveProxy({
      name: 'Office',
      type: 'http',
      address: 'proxy.internal',
      port: 3128,
      username: '',
    });
    expect(database.listProxies()).toEqual([proxy]);
    const host = database.saveHost({
      name: 'SSH',
      address: 'ssh.internal',
      port: 22,
      username: 'ops',
      protocol: 'ssh',
      proxyId: proxy.id,
    });
    expect(database.listHosts()[0]?.proxyId).toBe(proxy.id);
    expect(() => database.saveHost({ ...host, proxyId: randomUUID() }, host.id)).toThrow(
      /Proxy no longer exists/,
    );
    const backup = database.exportWorkspace();
    database.deleteProxy(proxy.id);
    expect(database.listProxies()).toEqual([]);
    expect(database.listHosts()[0]?.proxyId).toBeUndefined();
    for (let index = 1; index < MAX_PROXIES; index++)
      database.saveProxy({
        name: `P${index}`,
        type: 'http',
        address: 'proxy.internal',
        port: 3128,
        username: '',
      });
    database.saveProxy({ name: 'Last', type: 'socks5', address: 'p', port: 1, username: '' });
    expect(() =>
      database.saveProxy({ name: 'Extra', type: 'socks5', address: 'p', port: 1, username: '' }),
    ).toThrow(/Too many/);
    // Proxies are not exported: an import keeps a proxy link only when that proxy exists.
    database.deleteHost(host.id);
    database.importWorkspace(backup);
    expect(database.listHosts()[0]?.proxyId).toBeUndefined();
  });
});
