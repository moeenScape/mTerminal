import { randomUUID } from 'node:crypto';
import { isAbsolute, posix } from 'node:path';
import { validFileName } from '../../shared/files.js';
import { validTerminalId } from '../../shared/terminal.js';
import {
  TRANSFER_LIMIT,
  transferActive,
  type TransferJob,
  type TransferRequest,
  type TransferConflictPreview,
  type TransferCheckpoint,
  type TransferRecoveryRecord,
  type ResumeInspection,
} from '../../shared/transfers.js';
import type { TerminalRegistry } from '../terminal/registry.js';
import { FileBrowserError, fileErrorCode } from './listing.js';
import { TransferFailure, type TransferResume } from './transfer-file.js';
import { TransferConflict, conflictPreview } from './transfer-conflict.js';
import { resumableRecord } from './partial-cleanup.js';
import type { TransferRecoveryStore } from './transfer-recovery.js';

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
  private readonly records = new Map<string, TransferRecoveryRecord>();
  private readonly resumes = new Map<string, TransferResume>();
  private readonly approvals = new Map<string, TransferConflictPreview>();
  private readonly unsubscribe: () => void;
  get running(): boolean {
    return !!this.active;
  }
  constructor(
    private readonly terminals: TerminalRegistry,
    private readonly changed: () => void,
    private readonly recovery: Pick<TransferRecoveryStore, 'list' | 'save' | 'forget'>,
  ) {
    this.unsubscribe = terminals.onSessionClosed((id) => {
      for (const job of this.jobs)
        if (job.sessionId === id && transferActive(job.state)) this.cancel(job.id, 'disconnected');
    });
  }
  list(): TransferJob[] {
    return structuredClone(this.jobs);
  }
  listRecovery(): TransferRecoveryRecord[] {
    return this.recovery
      .list()
      .filter(
        (record) => !this.jobs.some((job) => job.id === record.id && transferActive(job.state)),
      );
  }
  forgetRecovery(id: string): void {
    if (this.jobs.some((job) => job.id === id && transferActive(job.state)))
      throw new FileBrowserError('busy');
    this.recovery.forget(id);
    this.records.delete(id);
    this.changed();
  }
  clearRecoveredPartial(id: string): void {
    const record = this.listRecovery().find((entry) => entry.id === id);
    if (!record) throw new FileBrowserError('recovery-stale');
    const updated = { ...record, partialPath: null, updatedAt: new Date().toISOString() };
    this.recovery.save(updated);
    this.records.set(id, updated);
    const job = this.jobs.find((entry) => entry.id === id);
    if (job) job.partialPath = null;
    this.changed();
  }
  private record(job: TransferJob, checkpoint?: TransferCheckpoint): void {
    const previous = this.records.get(job.id);
    const record: TransferRecoveryRecord = {
      id: job.id,
      sessionId: job.sessionId,
      title: job.title,
      direction: job.direction,
      localDirectory: job.localDirectory,
      remoteDirectory: job.remoteDirectory,
      name: job.name,
      state: job.state,
      peer: previous?.peer ?? this.terminals.transferPeer?.(job.sessionId) ?? null,
      updatedAt: new Date().toISOString(),
      phase: job.state === 'queued' ? 'queued' : 'settled',
      partialPath: job.partialPath,
      backupPath: job.backupPath,
      source: job.source ?? job.conflict?.source ?? previous?.source ?? null,
      destination: job.conflict?.destination ?? previous?.destination ?? null,
      ...(previous?.staging ? { staging: previous.staging } : {}),
      ...checkpoint,
    };
    this.recovery.save(record);
    this.records.set(job.id, record);
  }
  enqueueResume(
    record: TransferRecoveryRecord,
    sessionId: string,
    inspection: ResumeInspection,
  ): string {
    const saved = this.listRecovery().find((entry) => entry.id === record.id);
    const peer = this.terminals.transferPeer(sessionId);
    if (
      !saved ||
      JSON.stringify(saved) !== JSON.stringify(record) ||
      !resumableRecord(record) ||
      !peer ||
      !record.peer ||
      peer.address !== record.peer.address ||
      peer.port !== record.peer.port ||
      peer.username !== record.peer.username ||
      peer.fingerprint !== record.peer.fingerprint
    )
      throw new FileBrowserError('recovery-stale');
    const request: TransferRequest = {
      sessionId,
      title: record.title,
      direction: record.direction,
      localDirectory: record.localDirectory,
      remoteDirectory: record.remoteDirectory,
      name: record.name,
    };
    const approval = inspection.destination
      ? conflictPreview(record.source!, inspection.destination)
      : undefined;
    return this.enqueue(request, approval, { record, inspection });
  }
  enqueue(
    request: TransferRequest,
    approval?: TransferConflictPreview,
    resume?: TransferResume,
  ): string {
    if (this.disposed || !this.terminals.canTransfer(request.sessionId))
      throw new FileBrowserError('disconnected');
    const index = resume ? this.jobs.findIndex((job) => job.id === resume.record.id) : -1;
    if (index < 0 && this.jobs.length >= TRANSFER_LIMIT) throw new FileBrowserError('queue-full');
    const job: TransferJob = {
      ...request,
      id: resume?.record.id ?? randomUUID(),
      state: 'queued',
      transferred: resume?.inspection.file.size ?? 0,
      total: resume?.inspection.total ?? null,
      error: null,
      partialPath: resume?.record.partialPath ?? null,
      backupPath: null,
      conflict: null,
      source: resume?.record.source ?? null,
      destination: null,
    };
    if (resume) this.records.set(job.id, structuredClone(resume.record));
    this.record(job);
    if (index < 0) this.jobs.push(job);
    else this.jobs[index] = job;
    if (resume) this.resumes.set(job.id, structuredClone(resume));
    if (approval) this.approvals.set(job.id, structuredClone(approval));
    this.changed();
    void this.run();
    return job.id;
  }
  cancel(id: string, reason: 'cancelled' | 'disconnected' = 'cancelled'): void {
    const job = this.jobs.find((entry) => entry.id === id);
    if (!job || !transferActive(job.state)) return;
    if (job.state === 'queued' || job.state === 'conflict') {
      job.state = 'cancelled';
      job.error = reason;
    } else {
      job.state = 'cancelling';
      this.active?.controller.abort(new FileBrowserError(reason));
    }
    this.approvals.delete(id);
    this.resumes.delete(id);
    if (job.state === 'cancelled') {
      try {
        this.record(job);
      } catch {
        job.error = 'recovery-unavailable';
      }
    }
    this.changed();
  }
  clearFinished(): void {
    this.jobs = this.jobs.filter((job) => transferActive(job.state));
    this.changed();
  }
  resolve(id: string, token: string, choice: 'replace' | 'skip'): void {
    const job = this.jobs.find((entry) => entry.id === id);
    if (!job || job.state !== 'conflict' || job.conflict?.token !== token)
      throw new FileBrowserError('destination-changed');
    if (choice === 'skip') {
      job.state = 'skipped';
      job.error = null;
      job.conflict = null;
    } else {
      if (!job.conflict.replaceable || job.partialPath || job.backupPath)
        throw new FileBrowserError('unsupported');
      if (!this.terminals.canTransfer(job.sessionId)) throw new FileBrowserError('disconnected');
      this.approvals.set(id, structuredClone(job.conflict));
      job.state = 'queued';
      job.error = null;
      job.conflict = null;
      job.transferred = 0;
      job.total = null;
    }
    try {
      this.record(job);
    } catch (error) {
      job.state = 'failed';
      job.error = fileErrorCode(error);
      this.approvals.delete(id);
      this.changed();
      throw error;
    }
    this.changed();
    void this.run();
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
    const resume = this.resumes.get(job.id);
    this.resumes.delete(job.id);
    const approval = this.approvals.get(job.id);
    this.approvals.delete(job.id);
    try {
      this.record(job, {
        phase: 'queued',
        partialPath: resume?.record.partialPath ?? null,
        backupPath: null,
        source: resume?.record.source ?? null,
        destination: resume?.record.destination ?? null,
      });
      if (controller.signal.aborted) throw controller.signal.reason;
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
        approval,
        (checkpoint) => this.record(job, checkpoint),
        resume,
      );
      job.partialPath = outcome.partialPath;
      job.backupPath = outcome.backupPath ?? null;
      job.source = outcome.source ?? null;
      job.destination = outcome.destination ?? null;
      job.state = 'completed';
    } catch (error) {
      job.error = fileErrorCode(error);
      if (error instanceof TransferFailure || error instanceof TransferConflict) {
        job.partialPath = error.partialPath;
        job.backupPath = error.backupPath;
      }
      if (error instanceof TransferConflict) job.conflict = error.preview;
      job.state =
        error instanceof TransferConflict
          ? 'conflict'
          : job.error === 'uncertain'
            ? 'uncertain'
            : job.error === 'cancelled'
              ? 'cancelled'
              : 'failed';
    } finally {
      try {
        if (job.state === 'completed' && !job.partialPath && !job.backupPath) {
          this.recovery.forget(job.id);
          this.records.delete(job.id);
        } else this.record(job);
      } catch {
        // Keep the last durable checkpoint when recording the final outcome fails.
        job.state = 'uncertain';
        job.error = 'recovery-unavailable';
      }
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
