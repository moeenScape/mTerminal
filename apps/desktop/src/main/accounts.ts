import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, ipcMain, safeStorage, type BrowserWindow } from 'electron';
import {
  accountErrors,
  accountRoutes,
  normalizeAccountEmail,
  validAccountPassword,
  validAccountToken,
  type AccountErrorCode,
  type AccountSummary,
} from '../../../../packages/shared/accounts.ts';
import { ACCOUNT_REQUEST, type AccountResult, type AccountState } from '../shared/accounts.js';
import { validateAppInfoRequest } from './security.js';
import { secureStorageAvailable } from './storage/secret-store.js';

class AccountFailure extends Error {
  readonly code: AccountErrorCode;

  constructor(code: AccountErrorCode) {
    super(code);
    this.code = code;
  }
}

function accountOrigin(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    const local =
      !app.isPackaged &&
      url.protocol === 'http:' &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (
      (url.protocol === 'https:' || local) &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
    )
      return url.origin;
  } catch {
    // Invalid configuration leaves the account service unavailable.
  }
  return undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function summary(value: Record<string, unknown>): AccountSummary {
  const { email, currentDeviceId, currentSessionId, devices, sessions } = value;
  if (
    typeof email !== 'string' ||
    !normalizeAccountEmail(email) ||
    typeof currentDeviceId !== 'string' ||
    typeof currentSessionId !== 'string' ||
    !Array.isArray(devices) ||
    !Array.isArray(sessions) ||
    devices.length > 50 ||
    sessions.length > 50
  )
    throw new AccountFailure('unavailable');
  const readDate = (date: unknown): string => {
    if (typeof date === 'string' && Number.isFinite(Date.parse(date))) return date;
    throw new AccountFailure('unavailable');
  };
  return {
    email,
    currentDeviceId,
    currentSessionId,
    devices: devices.map((entry: unknown) => {
      const device = record(entry);
      if (typeof device?.id !== 'string' || typeof device.name !== 'string')
        throw new AccountFailure('unavailable');
      return { id: device.id, name: device.name, lastSignedInAt: readDate(device.lastSignedInAt) };
    }),
    sessions: sessions.map((entry: unknown) => {
      const session = record(entry);
      if (typeof session?.id !== 'string' || typeof session.deviceId !== 'string')
        throw new AccountFailure('unavailable');
      return {
        id: session.id,
        deviceId: session.deviceId,
        createdAt: readDate(session.createdAt),
        expiresAt: readDate(session.expiresAt),
      };
    }),
  };
}

let pending: Promise<void> = Promise.resolve();
let queued = 0;

export function attachAccounts(window: BrowserWindow, rendererUrl: string, deviceId: string): void {
  const origin = accountOrigin(process.env.MTERMINAL_ACCOUNT_URL);
  const tokenFile = join(app.getPath('userData'), 'account-session.enc');
  const deviceName =
    process.platform === 'darwin'
      ? 'mTerminal for macOS'
      : process.platform === 'win32'
        ? 'mTerminal for Windows'
        : 'mTerminal for Linux';
  let token: string | undefined;
  let loaded = false;
  let retained = false;

  async function loadToken(): Promise<void> {
    if (loaded) return;
    loaded = true;
    try {
      if (
        (await stat(tokenFile)).size > 4096 ||
        !(await secureStorageAvailable(safeStorage, process.platform))
      )
        return;
      const decrypted = await safeStorage.decryptStringAsync(await readFile(tokenFile));
      const saved = record(JSON.parse(decrypted.result));
      if (saved?.origin === origin && validAccountToken(saved?.token)) {
        token = saved.token;
        retained = true;
      }
    } catch {
      // An unavailable keychain or unreadable token requires signing in again.
    }
  }

  async function saveToken(value: string): Promise<void> {
    token = value;
    retained = false;
    const temporary = `${tokenFile}.${randomUUID()}.tmp`;
    try {
      if (!(await secureStorageAvailable(safeStorage, process.platform))) return;
      const encrypted = await safeStorage.encryptStringAsync(
        JSON.stringify({ origin, token: value }),
      );
      await writeFile(temporary, encrypted, { mode: 0o600, flag: 'wx' });
      await rename(temporary, tokenFile);
      retained = true;
    } catch {
      await rm(temporary, { force: true }).catch(() => {});
      // Keep a usable session in memory when secure persistence fails.
    }
  }

  async function clearToken(): Promise<void> {
    token = undefined;
    retained = false;
    await rm(tokenFile, { force: true }).catch(() => {});
  }

  async function request(
    path: string,
    method: string,
    payload?: object,
  ): Promise<Record<string, unknown>> {
    const response = await fetch(`${origin}${path}`, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(12_000),
      headers: {
        ...(payload ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    const reader = response.body?.getReader();
    if (!reader) throw new AccountFailure('unavailable');
    const parts: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > 64 * 1024) throw new AccountFailure('unavailable');
        parts.push(next.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const result = record(JSON.parse(Buffer.concat(parts).toString('utf8')));
    if (!response.ok) {
      const code = result?.code;
      throw new AccountFailure(
        typeof code === 'string' && Object.hasOwn(accountErrors, code)
          ? (code as AccountErrorCode)
          : 'unavailable',
      );
    }
    if (!result) throw new AccountFailure('unavailable');
    return result;
  }

  async function status(): Promise<AccountState> {
    if (token) {
      try {
        return {
          status: 'signed-in',
          account: summary(await request(accountRoutes.session, 'GET')),
          retained,
        };
      } catch (error) {
        if (!(error instanceof AccountFailure) || error.code !== 'sign-in-required') throw error;
        await clearToken();
      }
    }
    return { status: 'signed-out' };
  }

  async function handle(value: unknown): Promise<AccountState> {
    if (!origin) return { status: 'unconfigured' };
    if (window.isDestroyed()) throw new AccountFailure('unavailable');
    await loadToken();
    const action = record(value);
    if (action?.kind === 'status') return status();
    if (action?.kind === 'sign-out') {
      if (token) await request(accountRoutes.session, 'DELETE');
      await clearToken();
      return { status: 'signed-out' };
    }
    if (token) return status();
    const email = normalizeAccountEmail(action?.email);
    if (!email) throw new AccountFailure('invalid-input');
    if (action?.kind === 'register') {
      await request(accountRoutes.register, 'POST', { email });
      return { status: 'signed-out' };
    }
    if (!validAccountPassword(action?.password)) throw new AccountFailure('invalid-input');
    const login = { email, password: action.password, deviceId, deviceName };
    let result: Record<string, unknown>;
    if (action.kind === 'verify' && validAccountToken(action.code))
      result = await request(accountRoutes.verify, 'POST', { ...login, code: action.code });
    else if (action.kind === 'sign-in') result = await request(accountRoutes.signIn, 'POST', login);
    else throw new AccountFailure('invalid-input');
    if (!validAccountToken(result.token)) throw new AccountFailure('unavailable');
    await saveToken(result.token);
    return status();
  }

  ipcMain.handle(ACCOUNT_REQUEST, async (event, ...args: unknown[]): Promise<AccountResult> => {
    validateAppInfoRequest(event, window.webContents, rendererUrl, []);
    if (args.length !== 1) return { ok: false, code: 'invalid-input' };
    if (queued >= 8) return { ok: false, code: 'rate-limited' };
    queued++;
    const operation = pending.then(() => handle(args[0]));
    pending = operation.then(
      () => {},
      () => {},
    );
    try {
      return { ok: true, state: await operation };
    } catch (error) {
      return { ok: false, code: error instanceof AccountFailure ? error.code : 'unavailable' };
    } finally {
      queued--;
    }
  });
  window.once('closed', () => ipcMain.removeHandler(ACCOUNT_REQUEST));
}
