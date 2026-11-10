import { verifyKnownHost } from './known-hosts.js';
import { knownHostAddress } from '../storage/database.js';
import { SshChallenges } from './ssh-challenges.js';
import { openSsh } from './ssh.js';
import { resolveSshCredentials } from './credentials.js';
import { validHostId, resolveHost } from '../../shared/hosts.js';
import type { LocalDatabase } from '../storage/database.js';
import type { SshSecretStore } from '../storage/secret-store.js';
import { validTerminalInput } from '../../shared/terminal-input.js';
import { failureCode } from '../failures.js';
import { homedir } from 'node:os';
import { ipcMain, type BrowserWindow } from 'electron';
import {
  terminalChannels as channels,
  validTerminalId,
  validTerminalSize,
  type TerminalSize,
  type SshConnectionState,
  type TerminalOpenResult,
} from '../../shared/terminal.js';
import { validateAppInfoRequest } from '../security.js';
import type { DiagnosticLog } from '../diagnostics.js';
import { chooseShell, discoverShells } from './shells.js';
import { TerminalRegistry } from './registry.js';
import { installPublicKey } from './install-public-key.js';
import { utils } from '../ssh2-module.js';
import { AppFailure } from '../failures.js';
import { formatSshPublicKey } from '../../shared/ssh.js';
import { historyChannels, historyEvents, type HistorySearchMode } from '../../shared/history.js';
import { BashHistoryFile, bashHistoryPath, mergeHistory } from './native-history.js';
import { bashHistoryRc, BashHistoryStream } from './bash-history.js';

export function attachTerminal(
  window: BrowserWindow,
  rendererUrl: string,
  shellOverride: () => string,
  diagnostics: DiagnosticLog,
  database: LocalDatabase,
  secrets: SshSecretStore,
  recordHistory: () => boolean = () => true,
): TerminalRegistry {
  const bashHistory = new BashHistoryFile(bashHistoryPath());
  const historyChanged = () => {
    if (!window.webContents.isDestroyed()) window.webContents.send(historyEvents.changed);
  };
  /** Saved commands need an unlocked vault; the Bash history file is always available. */
  const savedHistory = async (query: string, directory: string, mode: HistorySearchMode) => {
    const state = await secrets.vaultStatus();
    if (!state.configured || state.locked || !state.available) return [];
    return secrets.searchHistory(query, directory, mode);
  };
  for (const channel of Object.values(historyChannels)) {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      validateAppInfoRequest(event, window.webContents, rendererUrl, []);
      try {
        if (
          channel === historyChannels.search &&
          args.length === 3 &&
          typeof args[0] === 'string' &&
          args[0].length <= 4096 &&
          typeof args[1] === 'string' &&
          args[1].length <= 4096 &&
          (args[2] === 'prefix' || args[2] === 'contains')
        ) {
          const [query, directory, mode] = args as [string, string, HistorySearchMode];
          const [saved, native] = await Promise.all([
            savedHistory(query, directory, mode),
            bashHistory.commands(),
          ]);
          return { ok: true, value: mergeHistory(saved, native, query, mode) };
        }
        if (channel === historyChannels.clear && !args.length) {
          await secrets.deleteHistory();
          historyChanged();
          return { ok: true, value: undefined };
        }
        if (channel === historyChannels.delete && args.length === 1 && validTerminalId(args[0])) {
          await secrets.deleteHistory(args[0]);
          historyChanged();
          return { ok: true, value: undefined };
        }
        throw new Error('Invalid history request.');
      } catch (error) {
        return { ok: false, code: failureCode(error, 'vault-unavailable') };
      }
    });
  }
  const terminal = new TerminalRegistry((event) => {
    if (event.kind === 'error') diagnostics.record('terminal-operation-failed', event.code);
    if (!window.webContents.isDestroyed()) window.webContents.send(channels.event, event);
  });
  const challenges = new SshChallenges((challenge) => {
    if (window.webContents.isDestroyed()) throw new Error('Window closed.');
    window.webContents.send(channels.sshChallenge, challenge);
  });
  ipcMain.on(channels.sshAnswer, (event, ...args: unknown[]) => {
    try {
      validateAppInfoRequest(event, window.webContents, rendererUrl, []);
      const [id, token, answers] = args;
      if (args.length !== 3 || !validTerminalId(id) || !validTerminalId(token))
        throw new Error('Invalid authentication reply.');
      challenges.answer(id, token, answers);
    } catch {
      diagnostics.record('terminal-operation-failed', 'ssh-failed');
    }
  });
  ipcMain.handle(channels.shells, async (event, ...args: unknown[]) => {
    validateAppInfoRequest(event, window.webContents, rendererUrl, args);
    try {
      return await discoverShells();
    } catch {
      return [];
    }
  });
  ipcMain.handle(channels.open, async (event, ...args: unknown[]): Promise<TerminalOpenResult> => {
    validateAppInfoRequest(event, window.webContents, rendererUrl, []);
    const [id, size] = args;
    if (args.length !== 2 || !validTerminalId(id) || !validTerminalSize(size))
      return { ok: false, code: 'terminal-failed' };
    try {
      await terminal.open(id, size, async (signal) => {
        const shell = await chooseShell(shellOverride());
        const { spawn } = await import('node-pty');
        if (signal.aborted) throw new Error('Terminal start cancelled.');
        const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
        for (const key of [
          'ELECTRON_RUN_AS_NODE',
          'ELECTRON_RENDERER_URL',
          'MTERMINAL_USER_DATA',
          'NODE_OPTIONS',
        ])
          delete env[key as keyof typeof env];
        // The prompt integration powers autocomplete; recording is checked per command.
        const integration = /(?:^|\/)bash$/.test(shell) ? await bashHistoryRc() : undefined;
        if (signal.aborted) {
          await integration?.dispose();
          throw new Error('Terminal start cancelled.');
        }
        let pty;
        try {
          pty = spawn(shell, integration ? ['--rcfile', integration.path, '-i'] : [], {
            name: 'xterm-256color',
            cwd: homedir(),
            cols: size.cols,
            rows: size.rows,
            env,
          });
        } catch (error) {
          await integration?.dispose();
          throw error;
        }
        if (!window.webContents.isDestroyed())
          window.webContents.send(channels.event, {
            kind: 'history-status',
            id,
            status: integration ? 'starting' : 'unsupported',
          });
        if (!integration) return pty;
        const clean = () => {
          void integration.dispose().catch(() => {});
        };
        const parser = new BashHistoryStream(
          integration.token,
          (command, directory) => {
            if (!recordHistory() || signal.aborted) return;
            void secrets
              .vaultStatus()
              .then(async (state) => {
                // While the vault is locked or not set up, commands are simply not saved.
                if (!state.configured || state.locked || !state.available) return;
                await secrets.recordCommand(command, directory);
                historyChanged();
              })
              .catch((error: unknown) => {
                if (!window.webContents.isDestroyed())
                  window.webContents.send(channels.event, {
                    kind: 'history-error',
                    id,
                    code: failureCode(error, 'vault-unavailable'),
                  });
              });
          },
          id,
        );
        return {
          write: (data) => pty.write(data),
          resize: (cols, rows) => pty.resize(cols, rows),
          pause: () => pty.pause(),
          resume: () => pty.resume(),
          kill: (signal) => {
            clean();
            pty.kill(signal);
          },
          onData: (listener) =>
            pty.onData((data) => {
              const text = parser.feed(data);
              if (text) listener(text);
            }),
          onExit: (listener) =>
            pty.onExit((event) => {
              clean();
              listener(event);
            }),
        };
      });
      return { ok: true };
    } catch (error) {
      const code = failureCode(error, 'terminal-failed');
      diagnostics.record('terminal-open-failed', code);
      return { ok: false, code };
    }
  });
  ipcMain.handle(channels.ssh, async (event, ...args: unknown[]): Promise<TerminalOpenResult> => {
    validateAppInfoRequest(event, window.webContents, rendererUrl, []);
    try {
      const [id, size, hostId, value] = args;
      if (
        args.length !== 4 ||
        !validTerminalId(id) ||
        !validTerminalSize(size) ||
        !validHostId(hostId)
      )
        throw new Error('Invalid request.');
      const credentialsInput = value;
      const host = database.listHosts().find((item) => item.id === hostId);
      if (!host) throw new Error('Host missing.');
      const resolved = resolveHost(host, database.listHostGroups());
      const effective = { ...resolved, address: knownHostAddress(resolved.address, resolved.port) };
      const credentials = await resolveSshCredentials(
        credentialsInput,
        resolved.identityId,
        secrets,
        hostId,
      );
      let reportReady: ((state: SshConnectionState) => void) | undefined;
      await terminal.open(id, size, (signal, report) => {
        reportReady = report;
        return openSsh(
          effective,
          credentials,
          size,
          signal,
          (question) => challenges.ask(id, question, signal),
          (key) =>
            verifyKnownHost(
              database,
              effective.address,
              effective.port,
              key,
              credentials.fingerprint,
              signal,
              (question) => challenges.ask(id, question, signal),
            ),
          report,
        );
      });
      reportReady?.('connected');
      return { ok: true };
    } catch (error) {
      const code = failureCode(error, 'ssh-failed');
      if (code !== 'ssh-cancelled') diagnostics.record('terminal-open-failed', code);
      return { ok: false, code };
    }
  });
  ipcMain.handle(
    channels.installPublicKey,
    async (event, ...args: unknown[]): Promise<TerminalOpenResult> => {
      validateAppInfoRequest(event, window.webContents, rendererUrl, []);
      try {
        const [hostId, enteredPassword] = args;
        if (
          args.length !== 2 ||
          !validHostId(hostId) ||
          typeof enteredPassword !== 'string' ||
          enteredPassword.length > 4096
        )
          throw new Error('Invalid key installation request.');
        const host = database.listHosts().find((item) => item.id === hostId);
        if (!host) throw new Error('Host not found.');
        const resolved = resolveHost(host, database.listHostGroups());
        if (!resolved.identityId) throw new Error('Assign an SSH identity to this host first.');
        const identity = database
          .listSshIdentities()
          .find((item) => item.id === resolved.identityId);
        if (!identity) throw new Error('SSH identity not found.');
        const key = await secrets.getPrivateKey(identity.id);
        if (!key) throw new AppFailure('vault-secret-missing');
        const parsed = utils.parseKey(key.privateKey, key.passphrase);
        if (parsed instanceof Error || Array.isArray(parsed) || !parsed.isPrivateKey())
          throw new AppFailure('vault-corrupt');
        const endpoint = knownHostAddress(resolved.address, resolved.port);
        const fingerprint = database.getKnownHost(endpoint, resolved.port);
        if (!fingerprint) throw new AppFailure('ssh-host-unverified');
        const password = enteredPassword || (await secrets.getPassword(identity.id));
        if (!password) throw new AppFailure('vault-secret-missing');
        await installPublicKey(
          { ...resolved, address: endpoint },
          identity.username || resolved.username,
          password,
          fingerprint,
          formatSshPublicKey(parsed.type, parsed.getPublicSSH(), parsed.comment),
        );
        return { ok: true };
      } catch (error) {
        const code = failureCode(error, 'ssh-key-install-failed');
        diagnostics.record('terminal-operation-failed', code);
        return { ok: false, code };
      }
    },
  );
  const operations = [channels.write, channels.resize, channels.ack, channels.close] as const;
  for (const channel of operations) {
    ipcMain.on(channel, (event, ...args: unknown[]) => {
      let ownedId: string | undefined;
      try {
        validateAppInfoRequest(event, window.webContents, rendererUrl, []);
        const [id, value] = args;
        if (!validTerminalId(id) || args.length !== (channel === channels.close ? 1 : 2))
          throw new Error('Invalid terminal request.');
        ownedId = id;
        if (channel === channels.close) terminal.close(id);
        else if (channel === channels.write && validTerminalInput(value)) terminal.write(id, value);
        else if (channel === channels.resize && validTerminalSize(value))
          terminal.resize(id, value as TerminalSize);
        else if (
          channel === channels.ack &&
          typeof value === 'number' &&
          Number.isInteger(value) &&
          value > 0 &&
          value <= 1024 * 1024
        )
          terminal.ack(id, value);
        else throw new Error('Invalid terminal request.');
      } catch {
        diagnostics.record('terminal-operation-failed', 'terminal-failed');
        if (ownedId) {
          terminal.close(ownedId);
          if (!window.webContents.isDestroyed())
            window.webContents.send(channels.event, {
              kind: 'error',
              id: ownedId,
              code: 'terminal-failed',
            });
        }
      }
    });
  }
  // Reset only after a committed main-frame navigation, not a blocked link attempt.
  window.webContents.on('did-navigate', () => terminal.reset());
  window.webContents.on('render-process-gone', () => terminal.reset());
  window.once('closed', () => {
    for (const channel of Object.values(historyChannels)) ipcMain.removeHandler(channel);
    terminal.dispose();
    ipcMain.removeHandler(channels.open);
    ipcMain.removeHandler(channels.ssh);
    ipcMain.removeHandler(channels.installPublicKey);
    ipcMain.removeAllListeners(channels.sshAnswer);
    ipcMain.removeHandler(channels.shells);
    for (const channel of operations) ipcMain.removeAllListeners(channel);
  });
  return terminal;
}
