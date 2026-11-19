import { connect, isIPv4, isIPv6, type Socket } from 'node:net';
import type { ProxyDraft } from '../../shared/proxies.js';
import { AppFailure } from '../failures.js';

const PROXY_TIMEOUT_MS = 20000;
const MAX_HTTP_RESPONSE = 16 * 1024;

type ProxyFailure = 'ssh-proxy-failed' | 'ssh-proxy-auth-failed' | 'ssh-proxy-refused';
class ProxyError extends Error {
  constructor(readonly code: ProxyFailure) {
    super(code);
  }
}

/** Buffers handshake bytes so each step can wait for exactly what it needs. */
class HandshakeReader {
  private buffer = Buffer.alloc(0);
  private waiting: (() => void) | undefined;
  private ended = false;
  constructor(private readonly socket: Socket) {
    socket.on('data', this.receive);
    socket.once('close', this.close);
  }
  private readonly receive = (chunk: Buffer) => {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.waiting?.();
  };
  private readonly close = () => {
    this.ended = true;
    this.waiting?.();
  };
  private async until(ready: () => boolean): Promise<void> {
    while (!ready()) {
      if (this.ended) throw new ProxyError('ssh-proxy-failed');
      await new Promise<void>((resolve) => (this.waiting = resolve));
      this.waiting = undefined;
    }
  }
  async read(length: number): Promise<Buffer> {
    await this.until(() => this.buffer.length >= length);
    const value = this.buffer.subarray(0, length);
    this.buffer = this.buffer.subarray(length);
    return value;
  }
  async readUntil(delimiter: string, max: number): Promise<Buffer> {
    let index = -1;
    await this.until(() => {
      index = this.buffer.indexOf(delimiter);
      if (index < 0 && this.buffer.length > max) throw new ProxyError('ssh-proxy-failed');
      return index >= 0;
    });
    const value = this.buffer.subarray(0, index + delimiter.length);
    this.buffer = this.buffer.subarray(index + delimiter.length);
    return value;
  }
  /** Stops reading and returns any bytes that already belong to the tunnelled stream. */
  release(): void {
    this.socket.off('data', this.receive);
    this.socket.off('close', this.close);
    this.socket.pause();
    if (this.buffer.length) this.socket.unshift(this.buffer);
  }
}

function socks5Address(host: string): Buffer {
  if (isIPv4(host)) return Buffer.from([0x01, ...host.split('.').map(Number)]);
  if (isIPv6(host)) {
    const groups = expandIPv6(host);
    const bytes = Buffer.alloc(17);
    bytes[0] = 0x04;
    groups.forEach((group, index) => bytes.writeUInt16BE(group, 1 + index * 2));
    return bytes;
  }
  const name = Buffer.from(host, 'latin1');
  if (name.length > 255) throw new ProxyError('ssh-proxy-refused');
  return Buffer.concat([Buffer.from([0x03, name.length]), name]);
}

export function expandIPv6(address: string): number[] {
  const [head = '', tail] = address.split('::');
  const parse = (part: string) => (part ? part.split(':').map((word) => parseInt(word, 16)) : []);
  const start = parse(head);
  const end = tail === undefined ? [] : parse(tail);
  const zeros = tail === undefined ? 0 : 8 - start.length - end.length;
  return [...start, ...new Array<number>(Math.max(0, zeros)).fill(0), ...end];
}

function portBytes(port: number): Buffer {
  const value = Buffer.alloc(2);
  value.writeUInt16BE(port);
  return value;
}

async function socks5(
  socket: Socket,
  reader: HandshakeReader,
  proxy: ProxyDraft,
  password: string | undefined,
  target: { address: string; port: number },
) {
  const auth = !!proxy.username;
  socket.write(Buffer.from(auth ? [0x05, 0x02, 0x00, 0x02] : [0x05, 0x01, 0x00]));
  const [version, method] = await reader.read(2);
  if (version !== 0x05) throw new ProxyError('ssh-proxy-failed');
  if (method === 0x02 && auth) {
    const user = Buffer.from(proxy.username, 'utf8');
    const secret = Buffer.from(password ?? '', 'utf8');
    if (user.length > 255 || secret.length > 255) throw new ProxyError('ssh-proxy-auth-failed');
    socket.write(
      Buffer.concat([Buffer.from([0x01, user.length]), user, Buffer.from([secret.length]), secret]),
    );
    const [, status] = await reader.read(2);
    if (status !== 0x00) throw new ProxyError('ssh-proxy-auth-failed');
  } else if (method !== 0x00) throw new ProxyError('ssh-proxy-auth-failed');
  socket.write(
    Buffer.concat([
      Buffer.from([0x05, 0x01, 0x00]),
      socks5Address(target.address),
      portBytes(target.port),
    ]),
  );
  const head = await reader.read(4);
  if (head[0] !== 0x05) throw new ProxyError('ssh-proxy-failed');
  if (head[1] !== 0x00) throw new ProxyError('ssh-proxy-refused');
  const type = head[3];
  const length =
    type === 0x01 ? 4 : type === 0x04 ? 16 : type === 0x03 ? (await reader.read(1))[0]! : -1;
  if (length < 0) throw new ProxyError('ssh-proxy-failed');
  await reader.read(length + 2);
}

async function socks4(
  socket: Socket,
  reader: HandshakeReader,
  proxy: ProxyDraft,
  target: { address: string; port: number },
) {
  const user = Buffer.from(proxy.username, 'utf8');
  const ipv4 = isIPv4(target.address);
  if (isIPv6(target.address)) throw new ProxyError('ssh-proxy-refused');
  socket.write(
    Buffer.concat([
      Buffer.from([0x04, 0x01]),
      portBytes(target.port),
      // SOCKS4a: 0.0.0.1 asks the proxy to resolve the name sent after the user ID.
      Buffer.from(ipv4 ? target.address.split('.').map(Number) : [0, 0, 0, 1]),
      user,
      Buffer.from([0]),
      ...(ipv4 ? [] : [Buffer.from(target.address, 'latin1'), Buffer.from([0])]),
    ]),
  );
  const reply = await reader.read(8);
  if (reply[1] === 0x5d || reply[1] === 0x5c) throw new ProxyError('ssh-proxy-auth-failed');
  if (reply[1] !== 0x5a) throw new ProxyError('ssh-proxy-refused');
}

async function httpConnect(
  socket: Socket,
  reader: HandshakeReader,
  proxy: ProxyDraft,
  password: string | undefined,
  target: { address: string; port: number },
) {
  const authority = `${isIPv6(target.address) ? `[${target.address}]` : target.address}:${target.port}`;
  const credentials = proxy.username
    ? `Proxy-Authorization: Basic ${Buffer.from(`${proxy.username}:${password ?? ''}`).toString('base64')}\r\n`
    : '';
  socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n${credentials}\r\n`);
  const response = (await reader.readUntil('\r\n\r\n', MAX_HTTP_RESPONSE)).toString('latin1');
  const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(response)?.[1]);
  if (status === 407) throw new ProxyError('ssh-proxy-auth-failed');
  if (!(status >= 200 && status < 300)) throw new ProxyError('ssh-proxy-refused');
}

/**
 * Opens a TCP connection to `target` through the proxy. The returned socket is paused and
 * ready to carry SSH; cancellation, timeouts and every failure destroy it.
 */
export function connectThroughProxy(
  proxy: ProxyDraft,
  password: string | undefined,
  target: { address: string; port: number },
  signal: AbortSignal,
): Promise<Socket> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new AppFailure('ssh-cancelled'));
      return;
    }
    const socket = connect({ host: proxy.address, port: proxy.port });
    let done = false;
    const finish = (error?: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', aborted);
      socket.off('error', failed);
      // ssh2 adds its own handler; this keeps a late error from becoming uncaught meanwhile.
      socket.on('error', () => {});
      if (error === undefined) {
        resolve(socket);
        return;
      }
      socket.destroy();
      reject(
        new AppFailure(
          signal.aborted
            ? 'ssh-cancelled'
            : error instanceof ProxyError
              ? error.code
              : 'ssh-proxy-failed',
        ),
      );
    };
    const failed = (error: unknown) => finish(error ?? new ProxyError('ssh-proxy-failed'));
    const aborted = () => finish(new ProxyError('ssh-proxy-failed'));
    const timer = setTimeout(() => finish(new ProxyError('ssh-proxy-failed')), PROXY_TIMEOUT_MS);
    signal.addEventListener('abort', aborted, { once: true });
    socket.on('error', failed);
    socket.once('connect', () => {
      const reader = new HandshakeReader(socket);
      const handshake =
        proxy.type === 'socks5'
          ? socks5(socket, reader, proxy, password, target)
          : proxy.type === 'socks4'
            ? socks4(socket, reader, proxy, target)
            : httpConnect(socket, reader, proxy, password, target);
      handshake
        .then(() => {
          reader.release();
          finish();
        })
        .catch((error: unknown) => finish(error));
    });
  });
}
