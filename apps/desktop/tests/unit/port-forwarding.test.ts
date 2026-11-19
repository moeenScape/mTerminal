import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, connect, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'ssh2';
import {
  describeForward,
  isLoopback,
  validatePortForward,
  MAX_FORWARD_RULES,
  type PortForwardDraft,
} from '../../src/shared/port-forwarding.js';
import {
  listenFailure,
  parseSocksGreeting,
  parseSocksRequest,
  startForward,
  type ForwardCounters,
} from '../../src/main/terminal/port-forward.js';
import { PortForwardManager } from '../../src/main/terminal/forwards-ipc.js';
import { LocalDatabase } from '../../src/main/storage/database.js';
import type { TerminalRegistry } from '../../src/main/terminal/registry.js';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), removeHandler: vi.fn() } }));

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function listenOn(server: Server): Promise<number> {
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
    }),
  );
}
async function echoServer(): Promise<number> {
  const server = createServer((socket) => socket.pipe(socket));
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return listenOn(server);
}
/** Stands in for ssh2: "server-side" connections are plain TCP connections from this machine. */
function fakeClient() {
  const opened: { host: string; port: number }[] = [];
  const client = {
    forwardOut: (
      _srcIP: string,
      _srcPort: number,
      host: string,
      port: number,
      callback: (error: Error | undefined, channel: Socket) => void,
    ) => {
      opened.push({ host, port });
      const socket = connect({ host, port });
      socket.once('connect', () => callback(undefined, socket));
      socket.once('error', (error) => {
        if (socket.connecting || !socket.remotePort) callback(error, socket);
      });
    },
  };
  return { client: client as unknown as Client, opened };
}
function roundTrip(port: number, payload: string, prelude?: Buffer[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port });
    let received = Buffer.alloc(0);
    let stage = 0;
    socket.on('error', reject);
    socket.on('connect', () => {
      if (prelude?.length) socket.write(prelude[0]!);
      else socket.write(payload);
    });
    socket.on('data', (chunk: Buffer) => {
      if (prelude && stage < prelude.length) {
        // Each SOCKS step gets one reply before the next is sent.
        stage++;
        if (stage < prelude.length) socket.write(prelude[stage]!);
        else socket.write(payload);
        const reply = chunk.subarray(stage === prelude.length ? 10 : 2);
        if (reply.length) received = Buffer.concat([received, reply]);
      } else received = Buffer.concat([received, chunk]);
      if (received.toString().includes(payload)) {
        socket.end();
        resolve(received.toString());
      }
    });
  });
}

describe('port forward rules', () => {
  it('validates and normalizes local, remote and dynamic rules', () => {
    expect(
      validatePortForward({
        name: ' DB ',
        kind: 'local',
        bindAddress: '',
        bindPort: 8080,
        destinationHost: '[::1]',
        destinationPort: 5432,
      }),
    ).toEqual({
      name: 'DB',
      kind: 'local',
      bindAddress: '127.0.0.1',
      bindPort: 8080,
      destinationHost: '::1',
      destinationPort: 5432,
    });
    expect(
      validatePortForward({
        name: '',
        kind: 'remote',
        bindAddress: 'localhost',
        bindPort: 0,
        destinationHost: 'localhost',
        destinationPort: 3000,
      }).bindPort,
    ).toBe(0);
    expect(
      validatePortForward({
        name: '',
        kind: 'dynamic',
        bindAddress: '127.0.0.1',
        bindPort: 1080,
        destinationHost: 'ignored',
        destinationPort: 9,
      }),
    ).toMatchObject({ destinationHost: '', destinationPort: 0 });
  });
  it('rejects unsafe or incomplete rules', () => {
    const base = {
      name: '',
      kind: 'local',
      bindAddress: '127.0.0.1',
      bindPort: 8080,
      destinationHost: 'db',
      destinationPort: 5432,
    };
    for (const bad of [
      { ...base, kind: 'tunnel' },
      { ...base, bindPort: 0 },
      { ...base, bindPort: 70000 },
      { ...base, destinationPort: 0 },
      { ...base, destinationHost: '-oProxyCommand=x' },
      { ...base, destinationHost: 'two words' },
      { ...base, bindAddress: 'bad\nhost' },
      { ...base, name: 'x'.repeat(101) },
      { ...base, extra: true },
    ])
      expect(() => validatePortForward(bad)).toThrow();
  });
  it('describes routes and recognizes loopback listen addresses', () => {
    const rule: PortForwardDraft = {
      name: '',
      kind: 'local',
      bindAddress: '127.0.0.1',
      bindPort: 8080,
      destinationHost: 'db',
      destinationPort: 5432,
    };
    expect(describeForward(rule)).toBe('127.0.0.1:8080 (this PC) → db:5432 (from server)');
    expect(describeForward({ ...rule, kind: 'remote', bindPort: 0 }, 40000)).toContain(
      '127.0.0.1:40000 (server)',
    );
    expect(isLoopback('127.0.0.5')).toBe(true);
    expect(isLoopback('::1')).toBe(true);
    expect(isLoopback('0.0.0.0')).toBe(false);
    expect(listenFailure({ code: 'EADDRINUSE' })).toBe('port-in-use');
    expect(listenFailure({ code: 'EACCES' })).toBe('port-denied');
    expect(listenFailure({ code: 'EADDRNOTAVAIL' })).toBe('address-unavailable');
  });
});

describe('SOCKS5 parsing', () => {
  it('accepts no-authentication greetings and refuses others', () => {
    expect(parseSocksGreeting(Buffer.from([5]))).toEqual({ kind: 'more' });
    expect(parseSocksGreeting(Buffer.from([5, 2, 2, 0]))).toMatchObject({
      kind: 'greeting',
      consumed: 4,
    });
    expect(parseSocksGreeting(Buffer.from([5, 1, 2]))).toMatchObject({ kind: 'error' });
    expect(parseSocksGreeting(Buffer.from([4, 1, 0]))).toEqual({ kind: 'error' });
  });
  it('parses IPv4, domain and IPv6 CONNECT requests', () => {
    expect(parseSocksRequest(Buffer.from([5, 1, 0, 1, 10, 0, 0, 7, 0x1f, 0x90]))).toEqual({
      kind: 'connect',
      consumed: 10,
      host: '10.0.0.7',
      port: 8080,
    });
    const name = Buffer.from('db.internal');
    expect(
      parseSocksRequest(
        Buffer.concat([Buffer.from([5, 1, 0, 3, name.length]), name, Buffer.from([0, 80])]),
      ),
    ).toMatchObject({ kind: 'connect', host: 'db.internal', port: 80 });
    const v6 = Buffer.alloc(22);
    v6.set([5, 1, 0, 4]);
    v6[19] = 1;
    v6.writeUInt16BE(443, 20);
    expect(parseSocksRequest(v6)).toMatchObject({ host: '0:0:0:0:0:0:0:1', port: 443 });
    expect(parseSocksRequest(Buffer.from([5, 1, 0, 1, 10]))).toEqual({ kind: 'more' });
    expect(parseSocksRequest(Buffer.from([5, 2, 0, 1, 0, 0, 0, 0, 0, 80]))).toMatchObject({
      kind: 'error',
    });
  });
});

describe('forward listeners', () => {
  it('tunnels local connections to the destination and closes them on stop', async () => {
    const target = await echoServer();
    const { client, opened } = fakeClient();
    const counters: ForwardCounters[] = [];
    const handle = await startForward(
      client,
      {
        name: '',
        kind: 'local',
        bindAddress: '127.0.0.1',
        bindPort: 0 as number,
        destinationHost: '127.0.0.1',
        destinationPort: target,
      },
      { update: (value) => counters.push(value), failed: vi.fn() },
    );
    cleanups.push(() => handle.stop());
    expect(handle.boundPort).toBeGreaterThan(0);
    expect(await roundTrip(handle.boundPort, 'hello-forward')).toContain('hello-forward');
    expect(opened).toEqual([{ host: '127.0.0.1', port: target }]);
    expect(counters.at(-1)?.totalConnections).toBe(1);
    handle.stop();
    await expect(roundTrip(handle.boundPort, 'x')).rejects.toThrow();
  });
  it('reports a busy local port', async () => {
    const busy = createServer();
    const port = await listenOn(busy);
    cleanups.push(() => new Promise<void>((resolve) => busy.close(() => resolve())));
    await expect(
      startForward(
        fakeClient().client,
        {
          name: '',
          kind: 'local',
          bindAddress: '127.0.0.1',
          bindPort: port,
          destinationHost: '127.0.0.1',
          destinationPort: 9,
        },
        { update: vi.fn(), failed: vi.fn() },
      ),
    ).rejects.toMatchObject({ code: 'port-in-use' });
  });
  it('serves SOCKS5 CONNECT requests through the SSH client', async () => {
    const target = await echoServer();
    const { client, opened } = fakeClient();
    const handle = await startForward(
      client,
      {
        name: '',
        kind: 'dynamic',
        bindAddress: '127.0.0.1',
        bindPort: 0 as number,
        destinationHost: '',
        destinationPort: 0,
      },
      { update: vi.fn(), failed: vi.fn() },
    );
    cleanups.push(() => handle.stop());
    const request = Buffer.from([5, 1, 0, 1, 127, 0, 0, 1, 0, 0]);
    request.writeUInt16BE(target, 8);
    expect(
      await roundTrip(handle.boundPort, 'through-socks', [Buffer.from([5, 1, 0]), request]),
    ).toContain('through-socks');
    expect(opened).toEqual([{ host: '127.0.0.1', port: target }]);
  });
});

describe('forward storage', () => {
  it('persists rules per host, enforces the limit and removes them with the host', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mterminal-forwards-'));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const path = join(directory, 'data.sqlite');
    let database = await LocalDatabase.open(path);
    try {
      const host = database.saveHost({
        name: 'SSH',
        address: 'example.internal',
        port: 22,
        username: 'deploy',
        protocol: 'ssh',
      });
      const draft: PortForwardDraft = {
        name: 'DB',
        kind: 'local',
        bindAddress: '127.0.0.1',
        bindPort: 15432,
        destinationHost: '127.0.0.1',
        destinationPort: 5432,
      };
      const rule = database.savePortForward(host.id, draft);
      database.close();
      database = await LocalDatabase.open(path);
      expect(database.listPortForwards(host.id)).toEqual([rule]);
      const edited = database.savePortForward(host.id, { ...draft, bindPort: 15433 }, rule.id);
      expect(database.portForward(rule.id)).toEqual(edited);
      expect(() => database.savePortForward(host.id, draft, randomUUID())).toThrow();
      for (let index = 1; index < MAX_FORWARD_RULES; index++)
        database.savePortForward(host.id, { ...draft, bindPort: 20000 + index });
      expect(() => database.savePortForward(host.id, draft)).toThrow(/Too many/);
      database.deletePortForward(rule.id);
      expect(database.portForward(rule.id)).toBeUndefined();
      database.deleteHost(host.id);
      expect(database.listPortForwards(host.id)).toEqual([]);
    } finally {
      database.close();
    }
  });
});

describe('forward manager', () => {
  it('starts on a connected session and stops every forward when the session closes', async () => {
    const rule = {
      id: randomUUID(),
      hostId: randomUUID(),
      name: '',
      kind: 'local' as const,
      bindAddress: '127.0.0.1',
      bindPort: 8080,
      destinationHost: 'db',
      destinationPort: 5432,
    };
    const sessionId = randomUUID();
    let closed: ((id: string) => void) | undefined;
    const stop = vi.fn();
    const terminals = {
      onSessionClosed: (listener: (id: string) => void) => {
        closed = listener;
        return () => {};
      },
      canForward: (id: string) => id === sessionId,
      startForward: vi.fn().mockResolvedValue({ boundPort: 8080, stop }),
    } as unknown as TerminalRegistry;
    const database = {
      portForward: (id: string) => (id === rule.id ? rule : undefined),
    } as unknown as LocalDatabase;
    const manager = new PortForwardManager(terminals, database, vi.fn());
    cleanups.push(() => manager.dispose());
    await manager.start(sessionId, rule.id);
    expect(manager.state()).toMatchObject([{ sessionId, status: 'active', boundPort: 8080 }]);
    await manager.start(sessionId, rule.id);
    expect(terminals.startForward).toHaveBeenCalledTimes(1);
    await expect(manager.start(randomUUID(), rule.id)).rejects.toMatchObject({
      code: 'disconnected',
    });
    closed!(sessionId);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(manager.state()).toEqual([]);
  });
});
