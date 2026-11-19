import { ipcMain, type BrowserWindow } from 'electron';
import {
  forwardChannels,
  FORWARDS_CHANGED,
  MAX_ACTIVE_FORWARDS,
  validForwardId,
  type ActiveForward,
  type ForwardError,
} from '../../shared/port-forwarding.js';
import { validHostId } from '../../shared/hosts.js';
import { validateAppInfoRequest } from '../security.js';
import type { LocalDatabase } from '../storage/database.js';
import { ForwardFailure, type ForwardHandle } from './port-forward.js';
import type { TerminalRegistry } from './registry.js';

export type ForwardResponse<T> = { ok: true; value: T } | { ok: false; code: ForwardError };

interface Entry {
  state: ActiveForward;
  handle?: ForwardHandle | undefined;
}

/** Owns every running forward of one window; forwards never outlive their SSH session. */
export class PortForwardManager {
  private readonly entries = new Map<string, Entry>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private readonly unsubscribe: () => void;
  constructor(
    private readonly terminals: TerminalRegistry,
    private readonly database: LocalDatabase,
    private readonly changed: () => void,
  ) {
    this.unsubscribe = terminals.onSessionClosed((id) => this.closeSession(id));
  }
  private notify(): void {
    if (this.timer || this.disposed) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.disposed) this.changed();
    }, 100);
  }
  state(): ActiveForward[] {
    return [...this.entries.values()].map(({ state }) => ({ ...state, rule: { ...state.rule } }));
  }
  get running(): number {
    return [...this.entries.values()].filter(({ state }) => state.status !== 'failed').length;
  }
  async start(sessionId: string, ruleId: string): Promise<void> {
    const rule = this.database.portForward(ruleId);
    if (!rule) throw new ForwardFailure('failed');
    if (!this.terminals.canForward(sessionId)) throw new ForwardFailure('disconnected');
    const key = `${sessionId}:${ruleId}`;
    const existing = this.entries.get(key);
    if (existing && existing.state.status !== 'failed') return;
    if (this.running >= MAX_ACTIVE_FORWARDS) throw new ForwardFailure('limit');
    const entry: Entry = {
      state: {
        sessionId,
        rule,
        status: 'starting',
        boundPort: null,
        connections: 0,
        totalConnections: 0,
        failedConnections: 0,
        error: null,
      },
    };
    this.entries.set(key, entry);
    this.notify();
    const current = () => this.entries.get(key) === entry && !this.disposed;
    try {
      const handle = await this.terminals.startForward(sessionId, rule, {
        update: (counters) => {
          if (!current()) return;
          Object.assign(entry.state, counters);
          this.notify();
        },
        failed: (error) => {
          if (!current()) return;
          entry.handle = undefined;
          entry.state = { ...entry.state, status: 'failed', error, connections: 0 };
          this.notify();
        },
      });
      if (!current()) {
        handle.stop();
        return;
      }
      entry.handle = handle;
      entry.state = { ...entry.state, status: 'active', boundPort: handle.boundPort };
      this.notify();
    } catch (error) {
      if (!current()) return;
      const code = error instanceof ForwardFailure ? error.code : 'failed';
      entry.state = {
        ...entry.state,
        status: 'failed',
        error: this.terminals.canForward(sessionId) ? code : 'disconnected',
      };
      this.notify();
    }
  }
  stop(sessionId: string, ruleId: string): void {
    const key = `${sessionId}:${ruleId}`;
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    entry.handle?.stop();
    this.notify();
  }
  /** Stops a rule everywhere, e.g. after it was edited or deleted. */
  stopRule(ruleId: string): void {
    for (const [key, entry] of [...this.entries])
      if (entry.state.rule.id === ruleId) {
        this.entries.delete(key);
        entry.handle?.stop();
        this.notify();
      }
  }
  private closeSession(sessionId: string): void {
    for (const [key, entry] of [...this.entries])
      if (entry.state.sessionId === sessionId) {
        this.entries.delete(key);
        entry.handle?.stop();
        this.notify();
      }
  }
  reset(): void {
    const entries = [...this.entries.values()];
    this.entries.clear();
    for (const entry of entries) entry.handle?.stop();
    this.notify();
  }
  dispose(): void {
    this.reset();
    this.disposed = true;
    clearTimeout(this.timer);
    this.unsubscribe();
  }
}

export function attachForwards(
  window: BrowserWindow,
  rendererUrl: string,
  terminals: TerminalRegistry,
  database: LocalDatabase,
) {
  const owner = window.webContents;
  const forwards = new PortForwardManager(terminals, database, () => {
    if (owner.isDestroyed()) return;
    try {
      owner.send(FORWARDS_CHANGED);
    } catch {
      /* The renderer can disappear during cleanup. */
    }
  });
  for (const channel of Object.values(forwardChannels))
    ipcMain.handle(
      channel,
      async (event, ...args: unknown[]): Promise<ForwardResponse<unknown>> => {
        validateAppInfoRequest(event, owner, rendererUrl, []);
        try {
          if (channel === forwardChannels.rules && args.length === 1)
            return { ok: true, value: database.listPortForwards(args[0]) };
          if (
            channel === forwardChannels.saveRule &&
            (args.length === 2 || args.length === 3) &&
            (args[2] === undefined || validForwardId(args[2]))
          ) {
            const rule = database.savePortForward(args[0], args[1], args[2]);
            if (args[2] !== undefined) forwards.stopRule(rule.id);
            return { ok: true, value: rule };
          }
          if (
            channel === forwardChannels.deleteRule &&
            args.length === 1 &&
            validForwardId(args[0])
          ) {
            forwards.stopRule(args[0]);
            database.deletePortForward(args[0]);
            return { ok: true, value: undefined };
          }
          if (channel === forwardChannels.state && !args.length)
            return { ok: true, value: forwards.state() };
          if (
            (channel === forwardChannels.start || channel === forwardChannels.stop) &&
            args.length === 2 &&
            validHostId(args[0]) &&
            validForwardId(args[1])
          ) {
            if (channel === forwardChannels.start) await forwards.start(args[0], args[1]);
            else forwards.stop(args[0], args[1]);
            return { ok: true, value: undefined };
          }
          throw new Error('Invalid forward request.');
        } catch (error) {
          return { ok: false, code: error instanceof ForwardFailure ? error.code : 'failed' };
        }
      },
    );
  const reset = () => forwards.reset();
  owner.on('did-navigate', reset);
  owner.on('render-process-gone', reset);
  window.once('closed', () => {
    forwards.dispose();
    owner.off('did-navigate', reset);
    owner.off('render-process-gone', reset);
    for (const channel of Object.values(forwardChannels)) ipcMain.removeHandler(channel);
  });
  return forwards;
}
