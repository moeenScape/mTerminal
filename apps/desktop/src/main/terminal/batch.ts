import { randomUUID } from 'node:crypto';
import {
  BATCH_CONCURRENCY,
  batchTargetKey,
  validateBatchRequest,
  type BatchPreview,
  type BatchState,
  type BatchTarget,
} from '../../shared/batch.js';
import type { TerminalRegistry } from './registry.js';
export class CommandBatch {
  private preview: BatchPreview | undefined;
  private job: (BatchState & { controller: AbortController }) | undefined;
  private disposed = false;
  constructor(
    private readonly terminals: Pick<TerminalRegistry, 'executionTargets' | 'executeCommand'>,
    private readonly changed: () => void,
  ) {}
  get running() {
    return !!this.job && !this.job.finished;
  }
  targets(): BatchTarget[] {
    if (this.disposed) return [];
    const seen = new Set<string>();
    return this.terminals
      .executionTargets()
      .filter((target) => {
        const key = batchTargetKey(target);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((target) => ({ ...target }));
  }
  prepare(value: unknown): BatchPreview {
    if (this.disposed || this.running) throw new Error('A command batch is already running.');
    const request = validateBatchRequest(value);
    const available = this.targets();
    const targets = request.sessionIds.map((id) => {
      const target = available.find((target) => target.sessionId === id);
      if (!target) throw new Error('A selected destination is unavailable.');
      return target;
    });
    this.preview = {
      token: randomUUID(),
      expiresAt: Date.now() + 60000,
      command: request.command,
      targets,
    };
    return structuredClone(this.preview);
  }
  start(token: string): BatchState {
    const preview = this.preview;
    this.preview = undefined;
    if (
      this.disposed ||
      this.running ||
      !preview ||
      preview.token !== token ||
      preview.expiresAt <= Date.now()
    )
      throw new Error('Review the destinations and command again.');
    const available = this.targets();
    if (
      preview.targets.some(
        (target) =>
          !available.some(
            (item) =>
              item.sessionId === target.sessionId &&
              batchTargetKey(item) === batchTargetKey(target),
          ),
      )
    )
      throw new Error('A reviewed destination changed or disconnected.');
    const job = {
      id: randomUUID(),
      command: preview.command,
      finished: false,
      cancelRequested: false,
      results: preview.targets.map((target) => ({
        target,
        status: 'queued' as const,
        stdout: '',
        stderr: '',
        exitCode: null,
        exitSignal: null,
      })),
      controller: new AbortController(),
    };
    this.job = job;
    void this.run(job);
    return this.state()!;
  }
  state(): BatchState | null {
    if (!this.job) return null;
    const { id, command, finished, cancelRequested, results } = this.job;
    return {
      id,
      command,
      finished,
      cancelRequested,
      results: results.map((row) => ({ ...row, target: { ...row.target } })),
    };
  }
  cancel(id: string): void {
    const job = this.job;
    if (!job || job.id !== id) throw new Error('Command batch no longer exists.');
    if (job.finished) return;
    job.cancelRequested = true;
    for (const row of job.results) if (row.status === 'queued') row.status = 'cancelled';
    job.controller.abort();
    this.changed();
  }
  reset(): void {
    const job = this.job;
    this.job = undefined;
    this.preview = undefined;
    job?.controller.abort();
    this.changed();
  }
  dispose(): void {
    this.disposed = true;
    this.reset();
  }
  private async run(job: NonNullable<CommandBatch['job']>) {
    let next = 0;
    const worker = async () => {
      while (this.job === job && !job.controller.signal.aborted) {
        const row = job.results[next++];
        if (!row) return;
        const target = this.targets().find(
          (item) =>
            item.sessionId === row.target.sessionId &&
            batchTargetKey(item) === batchTargetKey(row.target),
        );
        if (!target) {
          row.status = 'disconnected';
          this.changed();
          continue;
        }
        row.status = 'running';
        this.changed();
        try {
          Object.assign(
            row,
            await this.terminals.executeCommand(
              target.sessionId,
              job.command,
              job.controller.signal,
            ),
          );
        } catch {
          row.status = job.controller.signal.aborted ? 'cancelled' : 'failed';
        }
        if (this.job === job) this.changed();
      }
    };
    await Promise.all(Array.from({ length: BATCH_CONCURRENCY }, worker));
    if (this.job === job) {
      job.finished = true;
      this.changed();
    }
  }
}
