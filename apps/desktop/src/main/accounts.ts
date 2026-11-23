import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, dialog, ipcMain, safeStorage, type BrowserWindow } from 'electron';
import {
  accountErrors,
  accountRoutes,
  normalizeAccountEmail,
  validAccountPassword,
  validAccountToken,
  validAccountId,
  validSecondFactor,
  validDeviceLabel,
  DEVICE_DIRECTORY_LIMIT,
  SSH_PUBLIC_KEY_LIMIT,
  sshPublicKeyPattern,
  type DeviceDirectoryKey,
  type AccountErrorCode,
  type AccountSummary,
} from '../../../../packages/shared/accounts.ts';
import {
  ACCOUNT_REQUEST,
  DEVICE_DIRECTORY_REQUEST,
  type DeviceDirectoryResult,
  ORGANIZATION_REQUEST,
  type OrganizationResult,
  type AccountResponse,
  type AccountResult,
  type AccountState,
} from '../shared/accounts.js';
import {
  ORGANIZATION_ROUTE,
  parseOrganizationAction,
  type OrganizationView,
} from '../../../../packages/shared/organizations.ts';
import { AppFailure } from './failures.js';
import { validFingerprint } from '../shared/ssh.js';
import { validateAppInfoRequest } from './security.js';
import { secureStorageAvailable } from './storage/secret-store.js';
import type { SshSecretStore } from './storage/secret-store.js';
import { WorkspaceReview } from './storage/workspace-review.js';
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
import { SYNC_PREFERENCES_REQUEST, type SyncPreferenceReply } from '../shared/sync-preferences.js';
import { SyncPreferenceStore } from './storage/sync-preferences.js';
import { credentialOwners, syncCredential } from './storage/credential-sync.js';

import type { PreferencesStore } from './preferences.js';
import { PORTABLE_PREFERENCES_CHANGED } from '../shared/preferences.js';
import { SNIPPETS_CHANGED } from '../shared/snippets.js';
import {
  ORGANIZATION_VAULT_REQUEST,
  VAULT_ACCESS_REQUEST,
  type VaultAccessReply,
  parseSharedVaultAction,
  type SharedVaultReply,
} from '../shared/organization-vault.js';
import {
  ORGANIZATION_VAULTS_ROUTE,
  parseVaultAccessAction,
  validVaultGrant,
  type VaultAccessView,
} from '../../../../packages/shared/organization-vault.ts';
import { sharedVault } from './storage/organization-vault.js';

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

function vaultAccessResponse(value: Record<string, unknown>): VaultAccessView {
  if (!Array.isArray(value.vaults) || value.vaults.length > 50)
    throw new AccountFailure('unavailable');
  const view: VaultAccessView = {
    vaults: value.vaults.map((item: unknown) => {
      const vault = record(item);
      if (!vault) throw new AccountFailure('unavailable');
      const { id, name, access, allMembers } = vault;
      if (
        !validAccountId(id) ||
        !validDeviceLabel(name) ||
        (access !== 'owner' && !validVaultGrant(access)) ||
        typeof allMembers !== 'boolean'
      )
        throw new AccountFailure('unavailable');
      return { id, name, access, allMembers };
    }),
  };
  if (value.administration !== undefined) {
    const admin = record(value.administration);
    if (
      !admin ||
      !validAccountId(admin.vaultId) ||
      !Array.isArray(admin.members) ||
      admin.members.length > 100
    )
      throw new AccountFailure('unavailable');
    const vaultId = admin.vaultId;
    if (!view.vaults.some((vault) => vault.id === vaultId && vault.access === 'owner'))
      throw new AccountFailure('unavailable');
    view.administration = {
      vaultId,
      members: admin.members.map((item: unknown) => {
        const member = record(item);
        if (!member) throw new AccountFailure('unavailable');
        const { id, email, grant } = member;
        if (
          !validAccountId(id) ||
          typeof email !== 'string' ||
          normalizeAccountEmail(email) !== email ||
          (grant !== null && !validVaultGrant(grant))
        )
          throw new AccountFailure('unavailable');
        return { id, email, grant };
      }),
    };
  }
  return view;
}

function organizationResponse(value: Record<string, unknown>): OrganizationView {
  function items<T>(
    entries: unknown,
    limit: number,
    read: (entry: Record<string, unknown>) => T,
  ): T[] {
    if (!Array.isArray(entries) || entries.length > limit) throw new AccountFailure('unavailable');
    return entries.map((entry: unknown) => {
      const item = record(entry);
      if (!item) throw new AccountFailure('unavailable');
      return read(item);
    });
  }
  function expiration(value: unknown): string {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
      throw new AccountFailure('unavailable');
    return value;
  }
  const view: OrganizationView = {
    organizations: items(value.organizations, 50, ({ id, name, owner }) => {
      if (!validAccountId(id) || !validDeviceLabel(name) || typeof owner !== 'boolean')
        throw new AccountFailure('unavailable');
      return { id, name, owner };
    }),
    invitations: items(value.invitations, 100, ({ id, organizationName, expiresAt }) => {
      if (!validAccountId(id) || !validDeviceLabel(organizationName))
        throw new AccountFailure('unavailable');
      return { id, organizationName, expiresAt: expiration(expiresAt) };
    }),
  };
  if (value.roster !== undefined) {
    const roster = record(value.roster);
    const organizationId = roster?.organizationId;
    if (
      !roster ||
      !validAccountId(organizationId) ||
      !view.organizations.some(
        (organization) => organization.id === organizationId && organization.owner,
      )
    )
      throw new AccountFailure('unavailable');
    view.roster = {
      organizationId,
      members: items(roster.members, 100, ({ id, email, owner }) => {
        if (
          !validAccountId(id) ||
          typeof email !== 'string' ||
          normalizeAccountEmail(email) !== email ||
          typeof owner !== 'boolean'
        )
          throw new AccountFailure('unavailable');
        return { id, email, owner };
      }),
      invitations: items(roster.invitations, 100, ({ id, email, expiresAt }) => {
        if (
          !validAccountId(id) ||
          typeof email !== 'string' ||
          normalizeAccountEmail(email) !== email
        )
          throw new AccountFailure('unavailable');
        return { id, email, expiresAt: expiration(expiresAt) };
      }),
    };
  }
  return view;
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
      return {
        id: device.id,
        name: device.name,
        lastSignedInAt: readDate(device.lastSignedInAt),
        ...(device.retiredAt != null ? { retiredAt: readDate(device.retiredAt) } : {}),
      };
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
  secrets: SshSecretStore,
  preferences: PreferencesStore,
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
  const review = new WorkspaceReview(database, syncRequest, (id) =>
    secrets.hasStoredCredential(id),
  );

  function notifyPublication(): void {
    if (!window.isDestroyed() && !window.webContents.isDestroyed())
      window.webContents.send(SYNC_QUEUE_CHANGED);
  }

  function pausePublication(): void {
    review.clear();
    publication?.dispose();
    publication = undefined;
    notifyPublication();
  }

  function currentPublication(): WorkspacePublicationRunner {
    if (!origin || !accountId) throw new AccountFailure('sync-account-unverified');
    const expected = accountId;
    publication ??= new WorkspacePublicationRunner(
      new WorkspacePublication(userData, origin, expected),
      async (data, key) => {
        if (!(await syncPreferenceStore().read()).metadata)
          throw new WorkspaceSyncFailure('sync-disabled');
        return publishWorkspace(data, key, syncRequest, expected);
      },
      queueAccountOperation,
      notifyPublication,
    );
    return publication;
  }

  function syncPreferenceStore(): SyncPreferenceStore {
    if (!origin || !accountId) throw new WorkspaceSyncFailure('sync-account-unverified');
    return new SyncPreferenceStore(userData, origin, accountId);
  }

  async function confirmAccountAction(
    message: string,
    detail: string,
    affirmative: string,
    title = 'Account sync',
  ): Promise<boolean> {
    if (window.isDestroyed()) return false;
    const answer = await dialog.showMessageBox(window, {
      type: 'warning',
      title,
      message,
      detail,
      buttons: ['Cancel', affirmative],
      defaultId: 0,
      cancelId: 0,
    });
    return answer.response === 1 && !window.isDestroyed();
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
          if (
            action?.kind !== 'queue-status' &&
            action?.kind !== 'discard-publication' &&
            accountId &&
            !(await syncPreferenceStore().read()).metadata
          )
            throw new WorkspaceSyncFailure('sync-disabled');
          if (action?.kind === 'review' || action?.kind === 'apply-review') {
            if (!accountId) throw new AccountFailure('sync-account-unverified');
            publication?.suspend();
            return action.kind === 'review'
              ? review.preview(action.key, accountId)
              : review.apply(action, accountId);
          }
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
  ipcMain.handle(
    SYNC_PREFERENCES_REQUEST,
    async (event, ...args: unknown[]): Promise<SyncPreferenceReply> => {
      validateAppInfoRequest(event, window.webContents, rendererUrl, []);
      if (args.length !== 1) return { ok: false, code: 'invalid-input' };
      try {
        return await queueAccountOperation(async () => {
          if (!origin || window.isDestroyed()) throw new AccountFailure('unavailable');
          await loadToken();
          if (!token) throw new AccountFailure('sign-in-required');
          if (!accountId) throw new AccountFailure('sync-account-unverified');
          const action = record(args[0]);
          if (!action) throw new AccountFailure('invalid-input');
          const store = syncPreferenceStore();
          let preferences = await store.read();
          if (action.kind === 'status' || action.kind === 'set-category') {
            if (action.kind === 'set-category') {
              const { category, enabled } = action;
              if (
                (category !== 'metadata' && category !== 'credentials') ||
                typeof enabled !== 'boolean'
              )
                throw new AccountFailure('invalid-input');
              if (
                preferences[category] !== enabled &&
                (category !== 'credentials' ||
                  !enabled ||
                  (await confirmAccountAction(
                    'Allow encrypted credential sync on this device?',
                    'Each transfer of a saved SSH password or managed private key requires your confirmation and the credential sync key.',
                    'Enable credential sync',
                  )))
              ) {
                preferences = { ...preferences, [category]: enabled };
                await store.write(preferences);
                if (category === 'metadata' && !enabled) {
                  review.clear();
                  publication?.suspend();
                }
              }
            }
            return {
              ok: true,
              result: {
                kind: 'preferences',
                preferences,
                owners: preferences.credentials ? credentialOwners(database) : [],
              },
            };
          }
          if (!preferences.credentials) throw new AccountFailure('sync-disabled');
          const result = await syncCredential(
            action,
            accountId,
            database,
            secrets,
            syncRequest,
            (operation, label, kind) => {
              const item =
                kind === 'password'
                  ? 'saved SSH password'
                  : 'managed SSH private key and its passphrase';
              if (operation === 'publish')
                return confirmAccountAction(
                  `Publish the ${item}?`,
                  `${label}\nThis replaces any previous encrypted cloud copy for this profile.`,
                  'Publish credential',
                );
              if (operation === 'remove')
                return confirmAccountAction(
                  `Remove the cloud copy of the ${item}?`,
                  `${label}\nThe local credential stays in this device’s vault.`,
                  'Remove cloud copy',
                );
              return confirmAccountAction(
                `Restore the ${item}?`,
                `${label}\nThe credential will be stored in this device’s SSH vault.`,
                'Restore credential',
              );
            },
          );
          return { ok: true, result };
        });
      } catch (error) {
        return {
          ok: false,
          code:
            error instanceof AccountFailure || error instanceof WorkspaceSyncFailure
              ? error.code
              : 'unavailable',
        };
      }
    },
  );
  ipcMain.handle(
    DEVICE_DIRECTORY_REQUEST,
    async (event, ...args: unknown[]): Promise<DeviceDirectoryResult> => {
      validateAppInfoRequest(event, window.webContents, rendererUrl, []);
      const action = args.length === 1 ? record(args[0]) : undefined;
      if (!action) return { ok: false, code: 'invalid-input' };
      try {
        const keys = await queueAccountOperation(async () => {
          if (!origin || window.isDestroyed()) throw new AccountFailure('unavailable');
          await loadToken();
          if (!token) throw new AccountFailure('sign-in-required');
          const { kind, deviceId: target, identityId, name } = action;
          let payload: object | undefined;
          if (kind === 'publish-device-key' && validAccountId(identityId)) {
            const identity = database.listSshIdentities().find((entry) => entry.id === identityId);
            if (!identity || identity.method !== 'privateKey')
              throw new AccountFailure('device-key-invalid');
            if (
              await confirmAccountAction(
                'Publish this SSH public key?',
                `${identity.name}\nSigned-in devices on this account can view the public key and its label.`,
                'Publish public key',
                'Account devices',
              )
            ) {
              const status = await secrets.privateKeyStatus(identityId);
              if (!status.available) throw new AccountFailure('sync-vault-unavailable');
              if (!status.publicKey) throw new AccountFailure('device-key-invalid');
              const publicKey = status.publicKey.split(' ', 2).join(' ');
              const label = identity.name
                .slice(0, 80)
                .replace(/[\p{Cc}\p{Cs}]/gu, '')
                .trim();
              payload = { kind, identityId, name: label || 'SSH public key', publicKey };
            }
          } else if (kind === 'rename-device' && validAccountId(target) && validDeviceLabel(name)) {
            payload = { kind, deviceId: target, name };
          } else if (kind === 'restore-device' && validAccountId(target)) {
            payload = { kind, deviceId: target };
          } else if (kind === 'retire-device' && validAccountId(target)) {
            const account = summary(await request(accountRoutes.session, 'GET'));
            if (target === account.currentDeviceId) throw new AccountFailure('device-current');
            const device = account.devices.find((entry) => entry.id === target);
            if (!device || device.retiredAt) throw new AccountFailure('device-missing');
            if (
              await confirmAccountAction(
                `Retire ${device.name}?`,
                'This ends its account sessions, removes its directory entries, and blocks future sign-in from the installation until you allow it.',
                'Retire device',
                'Account devices',
              )
            )
              payload = { kind, deviceId: target };
          } else if (
            kind === 'remove-directory-key' &&
            validAccountId(target) &&
            validAccountId(identityId)
          ) {
            if (
              await confirmAccountAction(
                'Remove this public-key entry?',
                'Any copies installed on SSH servers remain authorized.',
                'Remove public key',
                'Account devices',
              )
            )
              payload = { kind, deviceId: target, identityId };
          } else if (kind !== 'status') {
            throw new AccountFailure('invalid-input');
          }
          const { keys } = await request(
            accountRoutes.devices,
            payload ? 'POST' : 'GET',
            payload,
            512 * 1024,
          );
          if (!Array.isArray(keys) || keys.length > DEVICE_DIRECTORY_LIMIT)
            throw new AccountFailure('unavailable');
          return keys.map((value: unknown): DeviceDirectoryKey => {
            const entry = record(value);
            if (!entry) throw new AccountFailure('unavailable');
            const { deviceId, deviceName, identityId, name, publicKey, fingerprint } = entry;
            if (
              !validAccountId(deviceId) ||
              !validAccountId(identityId) ||
              !validDeviceLabel(deviceName) ||
              !validDeviceLabel(name) ||
              typeof publicKey !== 'string' ||
              publicKey.length > SSH_PUBLIC_KEY_LIMIT ||
              !sshPublicKeyPattern.test(publicKey) ||
              !validFingerprint(fingerprint)
            )
              throw new AccountFailure('unavailable');
            return { deviceId, deviceName, identityId, name, publicKey, fingerprint };
          });
        });
        return { ok: true, keys };
      } catch (error) {
        if (error instanceof AppFailure && error.code === 'vault-locked')
          return { ok: false, code: 'device-vault-locked' };
        return { ok: false, code: error instanceof AccountFailure ? error.code : 'unavailable' };
      }
    },
  );
  ipcMain.handle(
    ORGANIZATION_REQUEST,
    async (event, ...args: unknown[]): Promise<OrganizationResult> => {
      validateAppInfoRequest(event, window.webContents, rendererUrl, []);
      const action = args.length === 1 ? parseOrganizationAction(args[0]) : undefined;
      if (!action) return { ok: false, code: 'invalid-input' };
      try {
        const view = await queueAccountOperation(async () => {
          if (!origin || window.isDestroyed()) throw new AccountFailure('unavailable');
          await loadToken();
          if (!token) throw new AccountFailure('sign-in-required');
          const response = await request(ORGANIZATION_ROUTE, 'POST', action, 256 * 1024);
          return organizationResponse(response);
        });
        return { ok: true, view };
      } catch (error) {
        return { ok: false, code: error instanceof AccountFailure ? error.code : 'unavailable' };
      }
    },
  );
  ipcMain.handle(
    ORGANIZATION_VAULT_REQUEST,
    async (event, ...args: unknown[]): Promise<SharedVaultReply> => {
      validateAppInfoRequest(event, window.webContents, rendererUrl, []);
      const action = args.length === 1 ? parseSharedVaultAction(args[0]) : undefined;
      if (!action) return { ok: false, code: 'invalid-input' };
      try {
        const view = await queueAccountOperation(async () => {
          if (!origin || window.isDestroyed()) throw new AccountFailure('unavailable');
          await loadToken();
          if (!token) throw new AccountFailure('sign-in-required');
          const result = await sharedVault(action, syncRequest, database, secrets, preferences);
          if (action.kind === 'import' && !window.webContents.isDestroyed()) {
            if (action.category === 'snippets') window.webContents.send(SNIPPETS_CHANGED);
            if (action.category === 'settings')
              window.webContents.send(PORTABLE_PREFERENCES_CHANGED, result.document?.settings);
          }
          return result;
        });
        return { ok: true, view };
      } catch (error) {
        if (error instanceof AppFailure && error.code === 'vault-locked')
          return { ok: false, code: 'sync-vault-locked' };
        const code =
          error instanceof AccountFailure || error instanceof WorkspaceSyncFailure
            ? error.code
            : 'organization-vault-local';
        return { ok: false, code };
      }
    },
  );
  ipcMain.handle(
    VAULT_ACCESS_REQUEST,
    async (event, ...args: unknown[]): Promise<VaultAccessReply> => {
      validateAppInfoRequest(event, window.webContents, rendererUrl, []);
      const action = args.length === 1 ? parseVaultAccessAction(args[0]) : undefined;
      if (!action) return { ok: false, code: 'invalid-input' };
      try {
        const view = await queueAccountOperation(async () => {
          if (!origin || window.isDestroyed()) throw new AccountFailure('unavailable');
          await loadToken();
          if (!token) throw new AccountFailure('sign-in-required');
          return vaultAccessResponse(await request(ORGANIZATION_VAULTS_ROUTE, 'POST', action));
        });
        return { ok: true, view };
      } catch (error) {
        return { ok: false, code: error instanceof AccountFailure ? error.code : 'unavailable' };
      }
    },
  );
  window.once('closed', () => {
    review.clear();
    publication?.dispose();
    ipcMain.removeHandler(ACCOUNT_REQUEST);
    ipcMain.removeHandler(DEVICE_DIRECTORY_REQUEST);
    ipcMain.removeHandler(ORGANIZATION_REQUEST);
    ipcMain.removeHandler(ORGANIZATION_VAULT_REQUEST);
    ipcMain.removeHandler(VAULT_ACCESS_REQUEST);
    ipcMain.removeHandler(SYNC_WORKSPACE_REQUEST);
    ipcMain.removeHandler(SYNC_PREFERENCES_REQUEST);
  });
}
