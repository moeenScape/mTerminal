import { randomUUID } from 'node:crypto';
import {
  MAX_LOG_CHARACTERS,
  logLabel,
  type SessionLog,
  type LogRecordingState,
} from '../../shared/session-logs.js';
import { validHostId } from '../../shared/hosts.js';
import type { TerminalRegistry } from './registry.js';
import type { SshSecretStore } from '../storage/secret-store.js';

/** Bounded streaming control filter; it retains no partial OSC/DCS payload. */
export class LogTextStream {
  private state: 'text' | 'escape' | 'csi' | 'string' | 'string-escape' = 'text';
  private cr = false;
  private high = '';
  feed(data: string): string {
    let text = '';
    for (let c of data) {
      if (this.high) {
        const high = this.high;
        this.high = '';
        const low = c.charCodeAt(0);
        if (low >= 0xdc00 && low <= 0xdfff) c = high + c;
      }
      if (c.length === 1 && c.charCodeAt(0) >= 0xd800 && c.charCodeAt(0) <= 0xdbff) {
        this.high = c;
        continue;
      }
      if (c.length === 1 && c.charCodeAt(0) >= 0xdc00 && c.charCodeAt(0) <= 0xdfff) continue;
      const code = c.charCodeAt(0);
      if (this.state === 'string') {
        if (code === 7 || code === 156) this.state = 'text';
        else if (code === 27) this.state = 'string-escape';
        continue;
      }
      if (this.state === 'string-escape') {
        this.state =
          c === '\\' || code === 7 || code === 156
            ? 'text'
            : code === 27
              ? 'string-escape'
              : 'string';
        continue;
      }
      if (code === 27) {
        this.state = 'escape';
        continue;
      }
      if (code === 155) {
        this.state = 'csi';
        continue;
      }
      if ([144, 152, 157, 158, 159].includes(code)) {
        this.state = 'string';
        continue;
      }
      if (this.state === 'csi') {
        if (code >= 64 && code <= 126) this.state = 'text';
        continue;
      }
      if (this.state === 'escape') {
        this.state =
          c === '['
            ? 'csi'
            : ']PX^_'.includes(c)
              ? 'string'
              : code >= 32 && code <= 47
                ? 'escape'
                : 'text';
        continue;
      }
      if (c === '\r') {
        text += '\n';
        this.cr = true;
        continue;
      }
      if (c === '\n' && this.cr) {
        this.cr = false;
        continue;
      }
      this.cr = false;
      if (c === '\n' || c === '\t' || (code >= 32 && !(code >= 127 && code <= 159))) text += c;
    }
    return text;
  }
}
type Context = {
  log: SessionLog;
  filter: LogTextStream;
  dirty: boolean;
  saving: boolean;
  failed: boolean;
};
export class SessionLogRecorder {
  private active: Context | null = null;
  private starting: Context | null = null;
  private generation = 0;
  private readonly sealing = new Set<string>();
  private message = '';
  private writes: Promise<void> = Promise.resolve();
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly unsubscribe: (() => void)[];
  private disposed = false;
  private blocked = false;
  suspend(value: boolean) {
    this.blocked = value;
    if (value) this.generation++;
  }
  constructor(
    private readonly terminals: Pick<TerminalRegistry, 'isReady' | 'onOutput' | 'onSessionClosed'>,
    private readonly store: Pick<SshSecretStore, 'saveSessionLog'>,
    private readonly changed: () => void,
  ) {
    this.unsubscribe = [
      terminals.onOutput((id, data) => this.output(id, data)),
      terminals.onSessionClosed((id) => {
        if (this.active?.log.sessionId === id) void this.stop('closed').catch(() => {});
      }),
    ];
    this.timer = setInterval(() => {
      const context = this.active;
      if (context?.dirty && !context.saving) void this.save(context).catch(() => {});
    }, 2000);
  }
  state(): LogRecordingState {
    return {
      active: this.active
        ? {
            logId: this.active.log.id,
            sessionId: this.active.log.sessionId,
            title: this.active.log.title,
          }
        : null,
      starting: !!this.starting,
      message: this.message,
    };
  }
  assertEditable(id: string) {
    if (this.active?.log.id === id || this.starting?.log.id === id || this.sealing.has(id))
      throw new Error('Stop recording before changing this log.');
  }
  private save(context: Context): Promise<void> {
    const snapshot = structuredClone(context.log);
    context.dirty = false;
    context.saving = true;
    const work = this.writes.then(async () => {
      if (context.failed) throw new Error('Recording failed.');
      await this.store.saveSessionLog(snapshot);
      this.changed();
    });
    this.writes = work
      .catch(() => {
        context.failed = true;
        if (this.active === context) this.active = null;
        this.message =
          'Recording failed. The last saved checkpoint is retained; an unsaved tail may be lost.';
        this.changed();
      })
      .finally(() => {
        context.saving = false;
      });
    return work;
  }
  async start(sessionId: string, title: string) {
    if (
      this.disposed ||
      this.blocked ||
      this.active ||
      this.starting ||
      !validHostId(sessionId) ||
      !this.terminals.isReady(sessionId)
    )
      throw new Error('Select a ready terminal and stop the current recording first.');
    const generation = ++this.generation;
    const now = Date.now();
    const context: Context = {
      log: {
        id: randomUUID(),
        sessionId,
        title: logLabel(title, 100),
        createdAt: now,
        updatedAt: now,
        text: '',
        notes: '',
        bookmarks: [],
        reason: 'checkpoint',
      },
      filter: new LogTextStream(),
      dirty: false,
      saving: false,
      failed: false,
    };
    this.starting = context;
    this.message = '';
    this.changed();
    try {
      await this.save(context);
      if (
        this.disposed ||
        this.blocked ||
        generation !== this.generation ||
        !this.terminals.isReady(sessionId)
      )
        throw new Error('Recording start cancelled.');
      this.active = context;
    } finally {
      if (this.starting === context) this.starting = null;
      this.changed();
    }
  }
  private output(id: string, data: string) {
    const context = this.active;
    if (!context || context.log.sessionId !== id) return;
    const text = context.filter.feed(data);
    const available = MAX_LOG_CHARACTERS - context.log.text.length;
    let taken = text.slice(0, available);
    if (
      taken &&
      taken.charCodeAt(taken.length - 1) >= 0xd800 &&
      taken.charCodeAt(taken.length - 1) <= 0xdbff
    )
      taken = taken.slice(0, -1);
    context.log.text += taken;
    context.log.updatedAt = Date.now();
    context.dirty ||= !!taken;
    if (text.length >= available) void this.stop('limit').catch(() => {});
  }
  async stop(reason: 'stopped' | 'closed' | 'limit' = 'stopped') {
    this.generation++;
    const context = this.active;
    this.active = null;
    this.changed();
    if (context) {
      context.log.reason = reason;
      context.log.updatedAt = Date.now();
      this.message =
        reason === 'limit' ? 'Recording stopped at the character limit.' : 'Recording stopped.';
      this.changed();
      this.sealing.add(context.log.id);
      try {
        await this.save(context);
      } finally {
        this.sealing.delete(context.log.id);
      }
    }
    await this.writes;
  }
  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.timer);
    for (const unsubscribe of this.unsubscribe) unsubscribe();
    await this.stop('closed');
  }
}
