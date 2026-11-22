import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  accountRoutes,
  normalizeAccountEmail,
  validAccountPassword,
  validAccountToken,
} from '../../../packages/shared/accounts.ts';
import { AccountFailure, type createAccounts } from './accounts.ts';

const MAX_BODY = 4096;

function reply(response: ServerResponse, status: number, value: object): void {
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (request.headers['content-type']?.split(';', 1)[0]?.trim() !== 'application/json')
    throw new AccountFailure('invalid-input');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const data = chunk as Buffer;
    size += data.length;
    if (size > MAX_BODY) throw new AccountFailure('invalid-input');
    chunks.push(data);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (value && typeof value === 'object' && !Array.isArray(value))
      return value as Record<string, unknown>;
  } catch {
    // Invalid JSON is handled as invalid input.
  }
  throw new AccountFailure('invalid-input');
}

const statuses = {
  'invalid-input': 400,
  'invalid-code': 400,
  'invalid-login': 401,
  'sign-in-required': 401,
  'rate-limited': 429,
  unavailable: 503,
} as const;

export function createAccountServer(accounts: ReturnType<typeof createAccounts>) {
  const attempts = new Map<string, number>();
  let windowEnd = 0;
  let active = 0;
  return createServer(
    { requestTimeout: 10_000, headersTimeout: 10_000, connectionsCheckingInterval: 1000 },
    async (request, response) => {
      let admitted = false;
      try {
        if (
          request.url === accountRoutes.session &&
          (request.method === 'GET' || request.method === 'DELETE')
        ) {
          const token = request.headers.authorization?.replace(/^Bearer /, '');
          if (!request.headers.authorization?.startsWith('Bearer ') || !validAccountToken(token))
            throw new AccountFailure('sign-in-required');
          if (request.method === 'GET') return reply(response, 200, await accounts.session(token));
          await accounts.signOut(token);
          return reply(response, 200, {});
        }
        const { register, verify, signIn } = accountRoutes;
        const path = request.url;
        if (
          request.method !== 'POST' ||
          (path !== register && path !== verify && path !== signIn)
        ) {
          request.resume();
          return reply(response, 404, { code: 'invalid-input' });
        }
        const now = Date.now();
        if (now >= windowEnd) {
          attempts.clear();
          windowEnd = now + 60_000;
        }
        const peer = request.socket.remoteAddress ?? '';
        const count = attempts.get(peer) ?? 0;
        if (active >= 4 || count >= 20 || (!count && attempts.size >= 4096))
          throw new AccountFailure('rate-limited');
        attempts.set(peer, count + 1);
        active++;
        admitted = true;
        const input = await body(request);
        const email = normalizeAccountEmail(input.email);
        if (!email) throw new AccountFailure('invalid-input');
        if (path === register) {
          await accounts.register(email);
          return reply(response, 202, {});
        }
        const { password, code, deviceId, deviceName } = input;
        if (
          !validAccountPassword(password) ||
          typeof deviceId !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            deviceId,
          ) ||
          typeof deviceName !== 'string' ||
          !deviceName.trim() ||
          deviceName.length > 80 ||
          /\p{Cc}/u.test(deviceName)
        )
          throw new AccountFailure('invalid-input');
        const device = { id: deviceId, name: deviceName.trim() };
        if (path === verify) {
          if (!validAccountToken(code)) throw new AccountFailure('invalid-code');
          return reply(response, 200, {
            token: await accounts.verify(email, code, password, device),
          });
        }
        return reply(response, 200, { token: await accounts.signIn(email, password, device) });
      } catch (error) {
        request.resume();
        const code = error instanceof AccountFailure ? error.code : 'unavailable';
        if (code === 'unavailable') console.error('Account request failed.');
        if (code === 'rate-limited') response.setHeader('Retry-After', '60');
        if (!request.complete) response.setHeader('Connection', 'close');
        if (!response.destroyed) reply(response, statuses[code], { code });
      } finally {
        if (admitted) active--;
      }
    },
  );
}
