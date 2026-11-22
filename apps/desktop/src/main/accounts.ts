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
  validAccountId,
  validSecondFactor,
  type AccountErrorCode,
  type AccountSummary,
} from '../../../../packages/shared/accounts.ts';
import {
  ACCOUNT_REQUEST,
  type AccountResponse,
  type AccountResult,
  type AccountState,
} from '../shared/accounts.js';
import { validateAppInfoRequest } from './security.js';
import { secureStorageAvailable } from './storage/secret-store.js';
import { SYNC_HTTP_LIMIT } from '../../../../packages/shared/workspace-sync.ts';
import {
  SYNC_WORKSPACE_REQUEST,
  SYNC_QUEUE_CHANGED,
  WorkspaceSyncFailure,
  type WorkspaceSyncReply,
} from '../shared/workspace-sync.js';
import { publishWorkspace, syncWorkspace } from './storage/workspace-sync.js';
import {
  WorkspacePublication,
  WorkspacePublicationRunner,
} from './storage/workspace-publication.js';
import type { LocalDatabase } from './storage/database.js';

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
  const { accountId, email, mfaEnabled, currentDeviceId, currentSessionId, devices, sessions } =
    value;
  if (
    typeof email !== 'string' ||
    !normalizeAccountEmail(email) ||
    typeof mfaEnabled !== 'boolean' ||
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
    ...(validAccountId(accountId) ? { accountId } : {}),
    email,
    mfaEnabled,
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

async function queueAccountOperation<T>(run: () => Promise<T>): Promise<T> {
  if (queued >= 8) throw new AccountFailure('rate-limited');
  queued++;
  const operation = pending.then(run);
  pending = operation.then(
    () => {},
    () => {},
  );
  try {
    return await operation;
  } finally {
    queued--;
  }
}

export function attachAccounts(
  window: BrowserWindow,
  rendererUrl: string,
  database: LocalDatabase,
): void {
  const deviceId = database.workspaceId;
  const origin = accountOrigin(process.env.MTERMINAL_ACCOUNT_URL);
  const userData = app.getPath('userData');
  const tokenFile = join(userData, 'account-session.enc');
  const deviceName =
    process.platform === 'darwin'
      ? 'mTerminal for macOS'
      : process.platform === 'win32'
        ? 'mTerminal for Windows'
        : 'mTerminal for Linux';
  let token: string | undefined;
  let loaded = false;
  let retained = false;
  let accountId: string | undefined;
  let publication: WorkspacePublicationRunner | undefined;

  function notifyPublication(): void {
    if (!window.isDestroyed() && !window.webContents.isDestroyed())
      window.webContents.send(SYNC_QUEUE_CHANGED);
  }

  function pausePublication(): void {
    publication?.dispose();
    publication = undefined;
    notifyPublication();
  }

  function currentPublication(): WorkspacePublicationRunner {
    if (!origin || !accountId) throw new AccountFailure('sync-account-unverified');
    const expected = accountId;
    publication ??= new WorkspacePublicationRunner(
      new WorkspacePublication(userData, origin, expected),
      (data, key) => publishWorkspace(data, key, syncRequest, expected),
      queueAccountOperation,
      notifyPublication,
    );
    return publication;
  }

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
        accountId = validAccountId(saved.accountId) ? saved.accountId : undefined;
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
        JSON.stringify({ origin, token: value, accountId }),
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
    accountId = undefined;
    retained = false;
    pausePublication();
    await rm(tokenFile, { force: true }).catch(() => {});
  }

  async function request(
    path: string,
    method: string,
    payload?: object,
    responseLimit?: number,
  ): Promise<Record<string, unknown>> {
    try {
      return await sendRequest(path, method, payload, responseLimit);
    } catch (error) {
      if (error instanceof AccountFailure) throw error;
      throw new AccountFailure('unavailable');
    }
  }

  async function sendRequest(
    path: string,
    method: string,
    payload?: object,
    responseLimit = 64 * 1024,
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
        if (bytes > responseLimit) throw new AccountFailure('unavailable');
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

  async function syncRequest(
    path: string,
    method: 'GET' | 'PUT',
    payload?: object,
  ): Promise<Record<string, unknown>> {
    if (window.isDestroyed()) throw new WorkspaceSyncFailure('unavailable');
    try {
      if (!token) throw new AccountFailure('sign-in-required');
      return await request(path, method, payload, SYNC_HTTP_LIMIT);
    } catch (error) {
      if (!(error instanceof AccountFailure)) throw error;
      if (error.code === 'sign-in-required') await clearToken();
      throw new WorkspaceSyncFailure(error.code);
    }
  }

  async function status(): Promise<AccountState> {
    if (token) {
      try {
        const account = summary(await request(accountRoutes.session, 'GET'));
        if (account.accountId && accountId !== account.accountId) {
          pausePublication();
          accountId = account.accountId;
          await saveToken(token);
        }
        return {
          status: 'signed-in',
          account,
          retained,
        };
      } catch (error) {
        if (error instanceof AccountFailure && error.code === 'unavailable' && accountId)
          return { status: 'offline' };
        if (!(error instanceof AccountFailure) || error.code !== 'sign-in-required') throw error;
        await clearToken();
      }
    }
    return { status: 'signed-out' };
  }

  async function protection(action: Record<string, unknown>): Promise<AccountResponse | undefined> {
    const { kind, password, factor, sessionId } = action;
    if (
      kind !== 'start-mfa' &&
      kind !== 'enable-mfa' &&
      kind !== 'disable-mfa' &&
      kind !== 'revoke-session'
    )
      return undefined;
    if (!token) throw new AccountFailure('sign-in-required');
    if (kind === 'revoke-session' && validAccountId(sessionId)) {
      await request(accountRoutes.protection, 'POST', { kind, sessionId });
      return status();
    }
    if (kind === 'start-mfa' && validAccountPassword(password)) {
      const result = await request(accountRoutes.protection, 'POST', { kind, password });
      if (typeof result.key !== 'string' || !/^[A-Z2-7]{32}$/.test(result.key))
        throw new AccountFailure('unavailable');
      return { status: 'mfa-setup', key: result.key };
    }
    if (kind === 'enable-mfa' && validSecondFactor(factor)) {
      const { recoveryCodes } = await request(accountRoutes.protection, 'POST', { kind, factor });
      if (
        !Array.isArray(recoveryCodes) ||
        recoveryCodes.length !== 8 ||
        !recoveryCodes.every(
          (code: unknown) => typeof code === 'string' && /^[a-f0-9]{32}$/.test(code),
        )
      )
        throw new AccountFailure('unavailable');
      return { status: 'mfa-enabled', recoveryCodes };
    }
    if (kind === 'disable-mfa' && validAccountPassword(password) && validSecondFactor(factor)) {
      await request(accountRoutes.protection, 'POST', { kind, password, factor });
      return status();
    }
    throw new AccountFailure('invalid-input');
  }

  async function handle(value: unknown): Promise<AccountResponse> {
    if (!origin) return { status: 'unconfigured' };
    if (window.isDestroyed()) throw new AccountFailure('unavailable');
    await loadToken();
    const action = record(value);
    if (action?.kind === 'status') return status();
    if (action?.kind === 'sign-out') {
      pausePublication();
      if (token) await request(accountRoutes.session, 'DELETE');
      await clearToken();
      return { status: 'signed-out' };
    }
    if (action) {
      const result = await protection(action);
      if (result) return result;
    }
    if (token) return status();
    const email = normalizeAccountEmail(action?.email);
    if (!email) throw new AccountFailure('invalid-input');
    if (action?.kind === 'register' || action?.kind === 'recover') {
      await request(
        action.kind === 'register' ? accountRoutes.register : accountRoutes.recover,
        'POST',
        { email },
      );
      return { status: 'signed-out' };
    }
    if (!validAccountPassword(action?.password)) throw new AccountFailure('invalid-input');
    const factor = action.factor;
    if (factor !== undefined && !validSecondFactor(factor))
      throw new AccountFailure('invalid-input');
    const secondFactor = factor ? { factor } : {};
    if (action.kind === 'reset' && validAccountToken(action.code)) {
      await request(accountRoutes.reset, 'POST', {
        email,
        password: action.password,
        code: action.code,
        ...secondFactor,
      });
      return { status: 'signed-out' };
    }
    const login = { email, password: action.password, deviceId, deviceName };
    let result: Record<string, unknown>;
    if (action.kind === 'verify' && validAccountToken(action.code))
      result = await request(accountRoutes.verify, 'POST', { ...login, code: action.code });
    else if (action.kind === 'sign-in')
      result = await request(accountRoutes.signIn, 'POST', { ...login, ...secondFactor });
    else throw new AccountFailure('invalid-input');
    if (!validAccountToken(result.token)) throw new AccountFailure('unavailable');
    await saveToken(result.token);
    return status();
  }

  ipcMain.handle(ACCOUNT_REQUEST, async (event, ...args: unknown[]): Promise<AccountResult> => {
    validateAppInfoRequest(event, window.webContents, rendererUrl, []);
    if (args.length !== 1) return { ok: false, code: 'invalid-input' };
    try {
      return { ok: true, state: await queueAccountOperation(() => handle(args[0])) };
    } catch (error) {
      return { ok: false, code: error instanceof AccountFailure ? error.code : 'unavailable' };
    }
  });
  ipcMain.handle(
    SYNC_WORKSPACE_REQUEST,
    async (event, ...args: unknown[]): Promise<WorkspaceSyncReply> => {
      validateAppInfoRequest(event, window.webContents, rendererUrl, []);
      if (args.length !== 1) return { ok: false, code: 'invalid-input' };
      try {
        const result = await queueAccountOperation(async () => {
          if (!origin || window.isDestroyed()) throw new AccountFailure('unavailable');
          await loadToken();
          if (!token) throw new AccountFailure('sign-in-required');
          const action = record(args[0]);
          if (action?.kind === 'queue-status') {
            return accountId
              ? await currentPublication().status()
              : { kind: 'queue-status' as const, queue: { status: 'idle' as const } };
          }
          if (action?.kind === 'discard-publication') return currentPublication().discard();
          if (action?.kind === 'retry-publication') return currentPublication().start(action.key);
          if (action?.kind === 'publish')
            return currentPublication().start(action.key, database.exportWorkspace());
          return syncWorkspace(action, database, syncRequest);
        });
        return { ok: true, result };
      } catch (error) {
        const code =
          error instanceof AccountFailure || error instanceof WorkspaceSyncFailure
            ? error.code
            : 'unavailable';
        return { ok: false, code };
      }
    },
  );
  window.once('closed', () => {
    publication?.dispose();
    ipcMain.removeHandler(ACCOUNT_REQUEST);
    ipcMain.removeHandler(SYNC_WORKSPACE_REQUEST);
  });
}
