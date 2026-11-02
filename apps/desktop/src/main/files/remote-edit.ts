import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join, posix } from 'node:path';
import { tmpdir } from 'node:os';
import {
  REMOTE_EDIT_MAX_BYTES,
  type RemoteEditRequest,
  type RemoteEditState,
} from '../../shared/remote-edit.js';
import { transferActive, type TransferFileInfo, type TransferJob } from '../../shared/transfers.js';
import type { TerminalRegistry } from '../terminal/registry.js';
import { TransferQueue, validTransferRequest } from './transfer-queue.js';
import { FileBrowserError, fileErrorCode } from './listing.js';
import { localFileInfo } from './transfer-conflict.js';
import { TransferFailure } from './transfer-file.js';

export function validRemoteEditRequest(value: unknown): value is RemoteEditRequest {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === 4 &&
    validTransferRequest({ ...value, direction: 'download', localDirectory: tmpdir() })
  );
}
export function validateEditText(bytes: Buffer): void {
  if (bytes.length > REMOTE_EDIT_MAX_BYTES) throw new FileBrowserError('editor-text-only');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new FileBrowserError('editor-text-only');
  }
  for (const character of text) {
    const code = character.charCodeAt(0);
    if ((code < 32 && ![9, 10, 13].includes(code)) || code === 127)
      throw new FileBrowserError('editor-text-only');
  }
}
export async function readEditCopy(path: string): Promise<{ bytes: Buffer; hash: string }> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size > REMOTE_EDIT_MAX_BYTES)
      throw new FileBrowserError('editor-text-only');
    const buffer = Buffer.alloc(REMOTE_EDIT_MAX_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    const after = await file.stat();
    const current = await lstat(path);
    if (
      after.size !== size ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      current.size !== after.size ||
      current.mtimeMs !== after.mtimeMs ||
      current.ctimeMs !== after.ctimeMs ||
      current.isSymbolicLink() ||
      current.dev !== after.dev ||
      current.ino !== after.ino
    )
      throw new FileBrowserError('editor-copy-unavailable');
    const bytes = buffer.subarray(0, size);
    validateEditText(bytes);
    return { bytes, hash: createHash('sha256').update(bytes).digest('hex') };
  } finally {
    await file.close();
  }
}
interface Editing {
  state: RemoteEditState;
  directory: string;
  baseline: TransferFileInfo | null;
  baseHash: string;
  uploadHash: string;
  snapshot: string | null;
  controller: AbortController;
}
export class RemoteEditManager {
  private current: Editing | null = null;
  private preparing: Promise<void> | undefined;
  private settingUp = false;
  private settling = false;
  private polling = false;
  private disposed = false;
  private finishing = false;
  private readonly interval: ReturnType<typeof setInterval>;
  private readonly unsubscribe: () => void;
  constructor(
    private readonly root: string,
    private readonly terminals: TerminalRegistry,
    private readonly transfers: TransferQueue,
    private readonly openText: (path: string) => Promise<void>,
    private readonly changed: () => void,
  ) {
    this.unsubscribe = terminals.onSessionClosed((id) => {
      if (this.current?.state.sessionId !== id) return;
      this.current.state.connected = false;
      this.current.controller.abort(new FileBrowserError('disconnected'));
      this.changed();
    });
    this.interval = setInterval(() => {
      void this.checkCopy();
    }, 1000);
    this.interval.unref();
  }
  state(): RemoteEditState | null {
    return this.current ? structuredClone(this.current.state) : null;
  }
  get busy(): boolean {
    return !!this.preparing || this.settingUp || this.settling || this.finishing;
  }
  async start(request: RemoteEditRequest): Promise<void> {
    if (this.current || this.disposed || this.busy) throw new FileBrowserError('editor-busy');
    if (!this.terminals.canTransfer(request.sessionId)) throw new FileBrowserError('disconnected');
    const edit: Editing = {
      state: {
        ...request,
        id: randomUUID(),
        localPath: '',
        workingDirectory: '',
        phase: 'downloading',
        changed: false,
        connected: true,
        hasCopy: false,
        size: 0,
        error: null,
        transferId: null,
        backupPath: null,
        partialPath: null,
      },
      directory: '',
      baseline: null,
      baseHash: '',
      uploadHash: '',
      snapshot: null,
      controller: new AbortController(),
    };
    this.current = edit;
    this.changed();
    const operation = this.prepare(edit);
    this.preparing = operation;
    void operation
      .catch(() => {})
      .finally(() => {
        if (this.preparing === operation) this.preparing = undefined;
      });
  }
  private async prepare(edit: Editing): Promise<void> {
    try {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      const root = await lstat(this.root);
      if (!root.isDirectory() || root.isSymbolicLink()) throw new FileBrowserError('unsupported');
      if (process.platform !== 'win32') await chmod(this.root, 0o700);
      edit.directory = await mkdtemp(join(await realpath(this.root), 'edit-'));
      edit.state.workingDirectory = edit.directory;
      edit.state.localPath = join(edit.directory, 'editing.txt');
      this.changed();
      const result = await this.terminals.prepareRemoteEdit(
        {
          sessionId: edit.state.sessionId,
          title: edit.state.title,
          remoteDirectory: edit.state.remoteDirectory,
          name: edit.state.name,
        },
        edit.directory,
        edit.controller.signal,
      );
      if (!result.source || result.source.kind !== 'file')
        throw new FileBrowserError('editor-text-only');
      edit.baseline = result.source;
      edit.state.partialPath = result.partialPath;
      const original = join(edit.directory, edit.state.name);
      if (original !== edit.state.localPath) await rename(original, edit.state.localPath);
      const copy = await readEditCopy(edit.state.localPath);
      edit.baseHash = copy.hash;
      edit.state.remoteDirectory = posix.dirname(result.source.path);
      edit.state.name = posix.basename(result.source.path);
      await writeFile(
        join(edit.directory, 'origin.json'),
        JSON.stringify({
          version: 1,
          remote: result.source,
          title: edit.state.title,
          sessionId: edit.state.sessionId,
        }),
        { flag: 'wx', mode: 0o600 },
      );
      edit.state.hasCopy = true;
      edit.state.size = copy.bytes.length;
      this.changed();
      if (edit.controller.signal.aborted) throw edit.controller.signal.reason;
      if (this.disposed) throw new FileBrowserError('cancelled');
      try {
        await this.openText(edit.state.localPath);
      } catch {
        throw new FileBrowserError('editor-launch-failed');
      }
      edit.state.phase = 'ready';
      this.changed();
    } catch (error) {
      edit.state.phase = edit.state.hasCopy ? 'ready' : 'failed';
      edit.state.error = fileErrorCode(error);
      if (error instanceof TransferFailure) {
        edit.state.partialPath = error.partialPath;
        edit.state.backupPath = error.backupPath;
      }
      if (!this.disposed) this.changed();
      throw error;
    }
  }
  async reopen(): Promise<void> {
    const edit = this.current;
    if (!edit?.state.hasCopy || this.preparing || this.finishing || this.disposed)
      throw new FileBrowserError('editor-copy-unavailable');
    await readEditCopy(edit.state.localPath);
    try {
      await this.openText(edit.state.localPath);
      if (edit.state.phase !== 'uncertain') edit.state.error = null;
    } catch {
      if (edit.state.phase !== 'uncertain') edit.state.error = 'editor-launch-failed';
      throw new FileBrowserError('editor-launch-failed');
    } finally {
      this.changed();
    }
  }
  async checkCopy(): Promise<void> {
    const edit = this.current;
    if (!edit?.state.hasCopy || this.polling || this.preparing || this.disposed) return;
    this.polling = true;
    try {
      const copy = await readEditCopy(edit.state.localPath);
      if (this.current !== edit || this.disposed) return;
      const changed = copy.hash !== edit.baseHash;
      const recovered =
        edit.state.error === 'editor-copy-unavailable' ||
        edit.state.error === 'editor-text-only' ||
        (edit.state.error === 'editor-unchanged' && changed);
      if (changed !== edit.state.changed || copy.bytes.length !== edit.state.size || recovered) {
        edit.state.changed = changed;
        edit.state.size = copy.bytes.length;
        if (recovered) edit.state.error = null;
        this.changed();
      }
    } catch (error) {
      if (this.current === edit && !this.disposed && edit.state.phase !== 'uncertain') {
        const code =
          error instanceof FileBrowserError && error.code === 'editor-text-only'
            ? error.code
            : 'editor-copy-unavailable';
        if (edit.state.error !== code) {
          edit.state.error = code;
          this.changed();
        }
      }
    } finally {
      this.polling = false;
    }
  }
  async upload(): Promise<void> {
    const edit = this.current;
    if (!edit?.state.hasCopy || !edit.baseline || this.busy || this.disposed)
      throw new FileBrowserError('editor-busy');
    if (!edit.state.connected || !this.terminals.canTransfer(edit.state.sessionId))
      throw new FileBrowserError('disconnected');
    if (
      edit.state.phase === 'uncertain' ||
      edit.state.partialPath ||
      (edit.state.backupPath && edit.state.phase === 'failed')
    )
      throw new FileBrowserError('uncertain');
    if (
      edit.state.transferId &&
      this.transfers
        .list()
        .some((job) => job.id === edit.state.transferId && transferActive(job.state))
    )
      throw new FileBrowserError('busy');
    this.settingUp = true;
    let enqueued = false;
    try {
      const copy = await readEditCopy(edit.state.localPath);
      if (copy.hash === edit.baseHash) throw new FileBrowserError('editor-unchanged');
      edit.snapshot = await mkdtemp(join(edit.directory, 'upload-'));
      const sourcePath = join(edit.snapshot, edit.state.name);
      await writeFile(sourcePath, copy.bytes, { flag: 'wx', mode: 0o600 });
      edit.uploadHash = copy.hash;
      const source = localFileInfo(sourcePath, await lstat(sourcePath));
      const request = {
        sessionId: edit.state.sessionId,
        title: edit.state.title,
        remoteDirectory: edit.state.remoteDirectory,
        localDirectory: edit.snapshot,
        name: edit.state.name,
        direction: 'upload' as const,
      };
      edit.state.phase = 'uploading';
      edit.state.error = null;
      edit.state.transferId = this.transfers.enqueue(request, {
        token: randomUUID(),
        source,
        destination: edit.baseline,
        replaceable: true,
      });
      enqueued = true;
      this.syncFromQueue();
      this.changed();
    } catch (error) {
      if (!enqueued && edit.snapshot) {
        try {
          await rm(edit.snapshot, { recursive: true, force: true });
          edit.snapshot = null;
        } catch {
          edit.state.partialPath = edit.snapshot;
        }
      }
      if (!enqueued) edit.state.phase = 'ready';
      edit.state.error = fileErrorCode(error);
      this.changed();
      throw error;
    } finally {
      this.settingUp = false;
    }
  }
  syncFromQueue(): void {
    const edit = this.current;
    if (!edit?.state.transferId || this.settling || this.disposed) return;
    const job = this.transfers.list().find((entry) => entry.id === edit.state.transferId);
    if (!job) return;
    if (transferActive(job.state)) {
      const phase = job.state === 'conflict' ? 'conflict' : 'uploading';
      if (edit.state.phase !== phase) {
        edit.state.phase = phase;
        this.changed();
      }
      return;
    }
    this.settling = true;
    edit.state.transferId = null;
    void this.settle(edit, job).finally(() => {
      this.settling = false;
    });
  }
  private async settle(edit: Editing, job: TransferJob): Promise<void> {
    try {
      edit.state.backupPath = job.backupPath;
      edit.state.partialPath = job.partialPath;
      if (job.state === 'completed' && job.destination) {
        edit.baseline = job.destination;
        edit.state.remoteDirectory = posix.dirname(job.destination.path);
        edit.state.name = posix.basename(job.destination.path);
        edit.baseHash = edit.uploadHash;
        edit.state.phase = 'ready';
        edit.state.error = null;
      } else {
        edit.state.phase =
          job.state === 'uncertain' || job.state === 'completed'
            ? 'uncertain'
            : job.state === 'failed'
              ? 'failed'
              : 'ready';
        edit.state.error = job.state === 'completed' ? 'uncertain' : job.error;
      }
      const needsRecovery =
        job.state === 'uncertain' || (job.state === 'failed' && !!job.backupPath);
      if (edit.snapshot && !job.partialPath && !needsRecovery) {
        await rm(edit.snapshot, { recursive: true, force: true });
        edit.snapshot = null;
      }
      if (needsRecovery && !edit.state.partialPath) edit.state.partialPath = edit.snapshot;
      await this.checkCopy();
    } catch {
      edit.state.error = 'editor-copy-unavailable';
      if (edit.snapshot) edit.state.partialPath = edit.snapshot;
    } finally {
      if (!this.disposed) this.changed();
    }
  }
  async finish(choice: 'keep' | 'discard'): Promise<string | null> {
    const edit = this.current;
    if (!edit) return null;
    if (
      this.finishing ||
      this.settingUp ||
      this.settling ||
      (edit.state.transferId &&
        this.transfers
          .list()
          .some((job) => job.id === edit.state.transferId && transferActive(job.state)))
    )
      throw new FileBrowserError('busy');
    this.finishing = true;
    try {
      edit.controller.abort(new FileBrowserError('cancelled'));
      await this.preparing?.catch(() => {});
      if (choice === 'discard' && edit.directory)
        await rm(edit.directory, { recursive: true, force: true });
      this.current = null;
      this.changed();
      return choice === 'keep' && edit.directory ? edit.directory : null;
    } finally {
      this.finishing = false;
    }
  }
  dispose(): void {
    this.disposed = true;
    clearInterval(this.interval);
    this.unsubscribe();
    this.current?.controller.abort(new FileBrowserError('cancelled'));
  }
}
