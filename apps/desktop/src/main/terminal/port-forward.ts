import { createServer, connect, type Server, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import type { Client, ClientChannel } from 'ssh2';
import {
  MAX_FORWARD_CONNECTIONS,
  type ForwardError,
  type PortForwardDraft,
} from '../../shared/port-forwarding.js';

export class ForwardFailure extends Error {
  constructor(readonly code: ForwardError) {
    super(code);
  }
}

export interface ForwardCounters {
  connections: number;
  totalConnections: number;
  failedConnections: number;
}
export interface ForwardEvents {
  /** Connection counters changed. */
  update: (counters: ForwardCounters) => void;
  /** The listener stopped unexpectedly after it was running. */
  failed: (error: ForwardError) => void;
}
export interface ForwardHandle {
  boundPort: number;
  stop: () => void;
}

const SOCKS_TIMEOUT_MS = 10000;
const SOCKS_MAX_HANDSHAKE = 600;
const ignore = () => {};

export function listenFailure(error: unknown): ForwardError {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (code === 'EADDRINUSE') return 'port-in-use';
  if (code === 'EACCES' || code === 'EPERM') return 'port-denied';
  if (code === 'EADDRNOTAVAIL' || code === 'ENOTFOUND' || code === 'EAI_AGAIN')
    return 'address-unavailable';
  return 'failed';
}

/** Tracks live tunnelled connections for one forward and reports counter changes. */
class Connections {
  readonly live = new Set<{ close: () => void }>();
  total = 0;
  failed = 0;
  constructor(private readonly report: (counters: ForwardCounters) => void) {}
  get full() {
    return this.live.size >= MAX_FORWARD_CONNECTIONS;
  }
  notify() {
    this.report({
      connections: this.live.size,
      totalConnections: this.total,
      failedConnections: this.failed,
    });
  }
  reject() {
    this.failed++;
    this.notify();
  }
  /** Pipes two streams; either side closing closes both exactly once. */
  pipe(a: Duplex, b: Duplex) {
    let closed = false;
    const entry = {
      close: () => {
        if (closed) return;
        closed = true;
        this.live.delete(entry);
        a.destroy();
        b.destroy();
        this.notify();
      },
    };
    this.live.add(entry);
    this.total++;
    a.on('error', ignore);
    b.on('error', ignore);
    a.once('close', entry.close);
    b.once('close', entry.close);
    a.pipe(b);
    b.pipe(a);
    this.notify();
  }
  closeAll() {
    for (const entry of [...this.live]) entry.close();
  }
}

function listen(server: Server, rule: PortForwardDraft): Promise<number> {
  return new Promise((resolve, reject) => {
    const failed = (error: unknown) => {
      server.close();
      reject(new ForwardFailure(listenFailure(error)));
    };
    server.once('error', failed);
    try {
      server.listen({ host: rule.bindAddress, port: rule.bindPort, exclusive: true }, () => {
        server.off('error', failed);
        const address = server.address();
        resolve(typeof address === 'object' && address ? address.port : rule.bindPort);
      });
    } catch (error) {
      failed(error);
    }
  });
}

function forwardOut(
  client: Client,
  socket: Socket,
  host: string,
  port: number,
): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    try {
      client.forwardOut(
        socket.remoteAddress ?? '127.0.0.1',
        socket.remotePort ?? 0,
        host,
        port,
        (error, channel) => (error ? reject(error) : resolve(channel)),
      );
    } catch (error) {
      reject(error);
    }
  });
}

/** Opens a listener on this PC; each connection is tunnelled through the server. */
async function startLocal(
  client: Client,
  rule: PortForwardDraft,
  events: ForwardEvents,
  socks: boolean,
): Promise<ForwardHandle> {
  const connections = new Connections(events.update);
  let stopped = false;
  const server = createServer({ pauseOnConnect: true }, (socket) => {
    socket.on('error', ignore);
    if (stopped || connections.full) {
      socket.destroy();
      connections.reject();
      return;
    }
    const target = socks
      ? socksHandshake(socket)
      : Promise.resolve({ host: rule.destinationHost, port: rule.destinationPort, rest: null });
    if (!socks) socket.pause();
    void target
      .then(async ({ host, port, rest }) => {
        let channel: ClientChannel;
        try {
          channel = await forwardOut(client, socket, host, port);
        } catch (error) {
          if (socks && !socket.destroyed) socket.end(socksReply(0x05));
          throw error;
        }
        if (stopped || socket.destroyed) {
          channel.on('error', ignore);
          channel.destroy();
          socket.destroy();
          return;
        }
        if (socks) socket.write(socksReply(0x00));
        if (rest?.length) channel.write(rest);
        connections.pipe(socket, channel);
        socket.resume();
      })
      .catch(() => {
        // Let a SOCKS error reply flush before the socket closes.
        if (!socket.writableEnded) socket.destroy();
        connections.reject();
      });
  });
  const boundPort = await listen(server, rule);
  server.on('error', () => {
    if (stopped) return;
    stopped = true;
    connections.closeAll();
    server.close();
    events.failed('failed');
  });
  return {
    boundPort,
    stop: () => {
      if (stopped) return;
      stopped = true;
      server.close();
      connections.closeAll();
    },
  };
}

/** Asks the server to listen; each incoming connection is opened to a target from this PC. */
async function startRemote(
  client: Client,
  rule: PortForwardDraft,
  events: ForwardEvents,
): Promise<ForwardHandle> {
  const connections = new Connections(events.update);
  let stopped = false;
  const boundPort = await new Promise<number>((resolve, reject) => {
    try {
      client.forwardIn(rule.bindAddress, rule.bindPort, (error, port) => {
        if (error) reject(new ForwardFailure('remote-refused'));
        else resolve(port || rule.bindPort);
      });
    } catch {
      reject(new ForwardFailure('remote-refused'));
    }
  });
  const incoming = (
    info: { destIP: string; destPort: number },
    accept: () => ClientChannel,
    rejectConnection: () => void,
  ) => {
    if (info.destPort !== boundPort) return;
    if (stopped || connections.full) {
      rejectConnection();
      connections.reject();
      return;
    }
    const channel = accept();
    channel.on('error', ignore);
    channel.pause();
    const socket = connect({ host: rule.destinationHost, port: rule.destinationPort });
    let connected = false;
    socket.on('error', () => {
      if (connected) return;
      channel.destroy();
      connections.reject();
    });
    socket.once('connect', () => {
      connected = true;
      if (stopped) {
        socket.destroy();
        channel.destroy();
        return;
      }
      connections.pipe(socket, channel);
      channel.resume();
    });
  };
  client.on('tcp connection', incoming);
  return {
    boundPort,
    stop: () => {
      if (stopped) return;
      stopped = true;
      client.off('tcp connection', incoming);
      try {
        client.unforwardIn(rule.bindAddress, boundPort, ignore);
      } catch {
        // The connection may already be closed.
      }
      connections.closeAll();
    },
  };
}

export function startForward(
  client: Client,
  rule: PortForwardDraft,
  events: ForwardEvents,
): Promise<ForwardHandle> {
  if (rule.kind === 'remote') return startRemote(client, rule, events);
  return startLocal(client, rule, events, rule.kind === 'dynamic');
}

// SOCKS5 (RFC 1928), no authentication, CONNECT only.

export type SocksParse =
  | { kind: 'more' }
  | { kind: 'error'; reply?: Buffer }
  | { kind: 'greeting'; consumed: number; reply: Buffer }
  | { kind: 'connect'; consumed: number; host: string; port: number };

export function socksReply(code: number): Buffer {
  return Buffer.from([0x05, code, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
}

export function parseSocksGreeting(data: Buffer): SocksParse {
  if (data.length < 2) return { kind: 'more' };
  if (data[0] !== 0x05) return { kind: 'error' };
  const count = data[1]!;
  if (data.length < 2 + count) return { kind: 'more' };
  const methods = data.subarray(2, 2 + count);
  if (!methods.includes(0x00)) return { kind: 'error', reply: Buffer.from([0x05, 0xff]) };
  return { kind: 'greeting', consumed: 2 + count, reply: Buffer.from([0x05, 0x00]) };
}

export function parseSocksRequest(data: Buffer): SocksParse {
  if (data.length < 4) return { kind: 'more' };
  if (data[0] !== 0x05 || data[2] !== 0x00) return { kind: 'error' };
  if (data[1] !== 0x01) return { kind: 'error', reply: socksReply(0x07) };
  const type = data[3];
  let host: string;
  let offset: number;
  if (type === 0x01) {
    if (data.length < 10) return { kind: 'more' };
    host = Array.from(data.subarray(4, 8)).join('.');
    offset = 8;
  } else if (type === 0x03) {
    if (data.length < 5) return { kind: 'more' };
    const length = data[4]!;
    if (!length) return { kind: 'error', reply: socksReply(0x01) };
    if (data.length < 5 + length + 2) return { kind: 'more' };
    host = data.subarray(5, 5 + length).toString('latin1');
    if (!/^[A-Za-z0-9._-]+$/.test(host)) return { kind: 'error', reply: socksReply(0x01) };
    offset = 5 + length;
  } else if (type === 0x04) {
    if (data.length < 22) return { kind: 'more' };
    const words: string[] = [];
    for (let index = 4; index < 20; index += 2) words.push(data.readUInt16BE(index).toString(16));
    host = words.join(':');
    offset = 20;
  } else return { kind: 'error', reply: socksReply(0x08) };
  const port = data.readUInt16BE(offset);
  if (!port) return { kind: 'error', reply: socksReply(0x01) };
  return { kind: 'connect', consumed: offset + 2, host, port };
}

function socksHandshake(socket: Socket): Promise<{ host: string; port: number; rest: Buffer }> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    let greeted = false;
    const timer = setTimeout(() => done(new Error('SOCKS handshake timed out.')), SOCKS_TIMEOUT_MS);
    const done = (error?: Error, value?: { host: string; port: number; rest: Buffer }) => {
      clearTimeout(timer);
      socket.off('data', receive);
      socket.off('close', closed);
      socket.pause();
      if (error) reject(error);
      else resolve(value!);
    };
    const closed = () => done(new Error('SOCKS client closed.'));
    const receive = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > SOCKS_MAX_HANDSHAKE) return done(new Error('SOCKS handshake too long.'));
      for (;;) {
        const result = greeted ? parseSocksRequest(buffer) : parseSocksGreeting(buffer);
        if (result.kind === 'more') return;
        if (result.kind === 'error') {
          if (result.reply) socket.end(result.reply);
          return done(new Error('Unsupported SOCKS request.'));
        }
        buffer = buffer.subarray(result.consumed);
        if (result.kind === 'greeting') {
          greeted = true;
          socket.write(result.reply);
          continue;
        }
        return done(undefined, { host: result.host, port: result.port, rest: buffer });
      }
    };
    socket.on('data', receive);
    socket.once('close', closed);
    socket.resume();
  });
}
