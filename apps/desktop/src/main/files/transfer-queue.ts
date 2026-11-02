import { randomUUID } from 'node:crypto';
import { isAbsolute, posix } from 'node:path';
import { validFileName } from '../../shared/files.js';
import { validTerminalId } from '../../shared/terminal.js';
import {
  TRANSFER_LIMIT,
  transferActive,
  type TransferJob,
  type TransferRequest,
} from '../../shared/transfers.js';
import type { TerminalRegistry } from '../terminal/registry.js';
import { FileBrowserError, fileErrorCode } from './listing.js';
import { TransferFailure } from './transfer-file.js';

export function validTransferRequest(value: unknown): value is TransferRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  return (
    Object.keys(request).length === 6 &&
    validTerminalId(request.sessionId) &&
    typeof request.title === 'string' &&
    !!request.title &&
    request.title.length <= 64 &&
    !Array.from(request.title).some((c) => c.charCodeAt(0) < 32) &&
    (request.direction === 'upload' || request.direction === 'download') &&
    validFileName(request.name) &&
    typeof request.localDirectory === 'string' &&
    isAbsolute(request.localDirectory) &&
    request.localDirectory.length <= 4096 &&
    !request.localDirectory.includes('\0') &&
    typeof request.remoteDirectory === 'string' &&
    posix.isAbsolute(request.remoteDirectory) &&
    request.remoteDirectory.length <= 4096 &&
    !request.remoteDirectory.includes('\0') &&
    !(
      process.platform === 'win32' &&
      /[<>:"|?*]|[. ]$|^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(request.name)
    )
  );
}

export class TransferQueue {
  private jobs: TransferJob[] = [];
  private active: { job: TransferJob; controller: AbortController } | undefined;
  private disposed = false;
  private readonly unsubscribe: () => void;
  get running(): boolean {
    return !!this.active;
  }
  constructor(
    private readonly terminals: TerminalRegistry,
    private readonly changed: () => void,
  ) {
    this.unsubscribe = terminals.onSessionClosed((id) => {
      for (const job of this.jobs)
        if (job.sessionId === id && transferActive(job.state)) this.cancel(job.id, 'disconnected');
    });
  }
  list(): TransferJob[] {
    return this.jobs.map((job) => ({ ...job }));
  }
  enqueue(request: TransferRequest): void {
    if (this.disposed || !this.terminals.canTransfer(request.sessionId))
      throw new FileBrowserError('disconnected');
    if (this.jobs.length >= TRANSFER_LIMIT) throw new FileBrowserError('queue-full');
    this.jobs.push({
      ...request,
      id: randomUUID(),
      state: 'queued',
      transferred: 0,
      total: null,
      error: null,
      partialPath: null,
    });
    this.changed();
    void this.run();
  }
  cancel(id: string, reason: 'cancelled' | 'disconnected' = 'cancelled'): void {
    const job = this.jobs.find((entry) => entry.id === id);
    if (!job || !transferActive(job.state)) return;
    if (job.state === 'queued') {
      job.state = 'cancelled';
      job.error = reason;
    } else {
      job.state = 'cancelling';
      this.active?.controller.abort(new FileBrowserError(reason));
    }
    this.changed();
  }
  clearFinished(): void {
    this.jobs = this.jobs.filter((job) => transferActive(job.state));
    this.changed();
  }
  private async run(): Promise<void> {
    if (this.disposed || this.active) return;
    const job = this.jobs.find((entry) => entry.state === 'queued');
    if (!job) return;
    const controller = new AbortController();
    this.active = { job, controller };
    job.state = 'running';
    this.changed();
    let lastUpdate = 0;
    try {
      const outcome = await this.terminals.transferFile(
        job.sessionId,
        job,
        controller.signal,
        (transferred, total) => {
          job.transferred = transferred;
          job.total = total;
          if (Date.now() - lastUpdate >= 200) {
            lastUpdate = Date.now();
            this.changed();
          }
        },
      );
      job.partialPath = outcome.partialPath;
      job.state = 'completed';
    } catch (error) {
      job.error = fileErrorCode(error);
      if (error instanceof TransferFailure) job.partialPath = error.partialPath;
      job.state =
        job.error === 'uncertain'
          ? 'uncertain'
          : job.error === 'cancelled'
            ? 'cancelled'
            : 'failed';
    } finally {
      this.active = undefined;
      this.changed();
      void this.run();
    }
  }
  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    for (const job of this.jobs) if (transferActive(job.state)) this.cancel(job.id);
  }
}
