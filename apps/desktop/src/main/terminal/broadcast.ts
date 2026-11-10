import { randomUUID } from 'node:crypto';
import {
  broadcastInput,
  validateBroadcastTargets,
  type BroadcastState,
  type BroadcastMode,
} from '../../shared/broadcast.js';
import { batchTargetKey } from '../../shared/batch.js';
import type { TerminalRegistry } from './registry.js';
export class InputBroadcast {
  private mode: BroadcastMode | null = null;
  private message = '';
  private disposed = false;
  private readonly unsubscribe: () => void;
  constructor(
    private readonly terminals: Pick<
      TerminalRegistry,
      'executionTargets' | 'write' | 'onSessionClosed'
    >,
    private readonly changed: () => void,
  ) {
    this.unsubscribe = terminals.onSessionClosed((id) => {
      if (this.mode?.targets.some((target) => target.sessionId === id))
        this.stop('Broadcast stopped because a recipient disconnected.');
    });
  }
  targets() {
    return this.disposed ? [] : this.terminals.executionTargets();
  }
  state(): BroadcastState {
    return { mode: this.mode ? structuredClone(this.mode) : null, message: this.message };
  }
  start(value: unknown): BroadcastState {
    if (this.disposed || this.mode)
      throw new Error('Stop the existing broadcast before selecting recipients.');
    const targets = validateBroadcastTargets(value);
    const available = this.targets();
    if (
      targets.some(
        (target) =>
          !available.some(
            (item) =>
              item.sessionId === target.sessionId &&
              batchTargetKey(item) === batchTargetKey(target),
          ),
      )
    )
      throw new Error('A broadcast recipient changed or disconnected.');
    this.mode = { id: randomUUID(), targets };
    this.message = '';
    this.changed();
    return this.state();
  }
  send(id: string, value: unknown): void {
    const mode = this.mode;
    if (this.disposed || !mode || mode.id !== id) throw new Error('Broadcast is no longer active.');
    const input = broadcastInput(value);
    const available = this.targets();
    if (
      mode.targets.some(
        (target) =>
          !available.some(
            (item) =>
              item.sessionId === target.sessionId &&
              batchTargetKey(item) === batchTargetKey(target),
          ),
      )
    ) {
      this.stop('Broadcast stopped because a recipient changed or disconnected.');
      throw new Error('Broadcast recipient unavailable.');
    }
    try {
      for (const target of mode.targets) {
        if (this.mode !== mode) throw new Error('Broadcast stopped during delivery.');
        this.terminals.write(target.sessionId, input);
      }
    } catch {
      this.stop('Broadcast stopped after an input failure. Already-sent input cannot be undone.');
      throw new Error('Broadcast input failed.');
    }
  }
  stop(message = 'Broadcast stopped.'): void {
    if (!this.mode) return;
    this.mode = null;
    this.message = message;
    this.changed();
  }
  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    this.stop();
  }
}
