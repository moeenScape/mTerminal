import { lstat, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  RemoteEditManager,
  readEditCopy,
  validRemoteEditRequest,
  validateEditText,
} from '../../src/main/files/remote-edit.js';
import type { TerminalRegistry } from '../../src/main/terminal/registry.js';
import type { TransferQueue } from '../../src/main/files/transfer-queue.js';
import type {
  TransferConflictPreview,
  TransferJob,
  TransferRequest,
  TransferFileInfo,
} from '../../src/shared/transfers.js';
import { REMOTE_EDIT_MAX_BYTES, type RemoteEditRequest } from '../../src/shared/remote-edit.js';

const request: RemoteEditRequest = {
  sessionId: '04e9f162-d3cd-4c8f-a70a-2323a1751a9b',
  title: 'Editor fixture',
  remoteDirectory: '/remote',
  name: 'config.sh',
};
async function fixture(bytes = Buffer.from('initial text\n')) {
  const root = await mkdtemp(join(tmpdir(), 'mterminal-remote-edit-'));
  const jobs: TransferJob[] = [];
  let connected = true;
  const closed = new Set<(id: string) => void>();
  const source: TransferFileInfo = {
    path: '/remote/config.sh',
    kind: 'file',
    size: bytes.length,
    modified: 1700000000000,
    permissions: '0644',
    version: 'original',
  };
  const enqueue = vi.fn<(job: TransferRequest, approval?: TransferConflictPreview) => string>(
    (job) => {
      const id = '14e9f162-d3cd-4c8f-a70a-2323a1751a9b';
      jobs.push({
        ...job,
        id,
        state: 'queued',
        transferred: 0,
        total: null,
        error: null,
        partialPath: null,
        backupPath: null,
        conflict: null,
        source: null,
        destination: null,
      });
      return id;
    },
  );
  const terminals = {
    onSessionClosed: (listener: (id: string) => void) => {
      closed.add(listener);
      return () => {
        closed.delete(listener);
      };
    },
    canTransfer: () => connected,
    prepareRemoteEdit: async (value: RemoteEditRequest, directory: string) => {
      await writeFile(join(directory, value.name), bytes, { mode: 0o600 });
      return { partialPath: null, source };
    },
  } as unknown as TerminalRegistry;
  const queue = { enqueue, list: () => structuredClone(jobs) } as unknown as TransferQueue;
  const launch = vi.fn<(path: string) => Promise<void>>(async () => {});
  const manager = new RemoteEditManager(root, terminals, queue, launch, vi.fn());
  const ready = async () => {
    await manager.start(request);
    await vi.waitFor(() => {
      expect(manager.state()?.phase).toBe('ready');
      expect(manager.busy).toBe(false);
    });
  };
  return {
    root,
    manager,
    jobs,
    enqueue,
    launch,
    source,
    ready,
    disconnect: () => {
      connected = false;
      for (const listener of closed) listener(request.sessionId);
    },
    dispose: async () => {
      manager.dispose();
      await rm(root, { recursive: true, force: true });
    },
  };
}

describe('remote text editing', () => {
  it('opens a private .txt copy, detects changes, and uploads an immutable snapshot only on request', async () => {
    const context = await fixture();
    try {
      await context.ready();
      const state = context.manager.state()!;
      expect(state.localPath).toMatch(/editing\.txt$/);
      expect(context.launch).toHaveBeenCalledWith(state.localPath);
      expect(context.launch.mock.calls.some(([path]) => path.endsWith('.sh'))).toBe(false);
      expect(context.enqueue).not.toHaveBeenCalled();
      if (process.platform !== 'win32') {
        expect((await lstat(state.workingDirectory)).mode & 0o777).toBe(0o700);
        expect((await lstat(state.localPath)).mode & 0o777).toBe(0o600);
      }
      await writeFile(state.localPath, 'saved version one');
      await context.manager.checkCopy();
      expect(context.manager.state()?.changed).toBe(true);
      expect(context.enqueue).not.toHaveBeenCalled();
      await context.manager.upload();
      const [queued, approval] = context.enqueue.mock.calls[0]!;
      expect(approval?.destination.version).toBe('original');
      expect(await readFile(join(queued.localDirectory, queued.name), 'utf8')).toBe(
        'saved version one',
      );
      await writeFile(state.localPath, 'saved version two while uploading');
      expect(await readFile(join(queued.localDirectory, queued.name), 'utf8')).toBe(
        'saved version one',
      );
      context.jobs[0]!.state = 'completed';
      context.jobs[0]!.destination = { ...context.source, version: 'uploaded version', size: 17 };
      context.jobs[0]!.backupPath = '/remote/previous.bak';
      context.manager.syncFromQueue();
      await vi.waitFor(() => {
        expect(context.manager.busy).toBe(false);
        expect(context.manager.state()?.phase).toBe('ready');
      });
      await context.manager.checkCopy();
      expect(context.manager.state()?.changed).toBe(true);
      expect(context.manager.state()?.backupPath).toBe('/remote/previous.bak');
      await expect(lstat(queued.localDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
      await context.manager.upload();
      expect(context.enqueue.mock.calls[1]?.[1]?.destination.version).toBe('uploaded version');
    } finally {
      await context.dispose();
    }
  });
  it('preserves the working copy on disconnect and keeps its origin metadata on finish', async () => {
    const context = await fixture();
    try {
      await context.ready();
      const state = context.manager.state()!;
      await writeFile(state.localPath, 'my saved work');
      context.disconnect();
      expect(context.manager.state()?.connected).toBe(false);
      await expect(context.manager.upload()).rejects.toMatchObject({ code: 'disconnected' });
      await context.manager.reopen();
      expect(await readFile(state.localPath, 'utf8')).toBe('my saved work');
      const kept = await context.manager.finish('keep');
      expect(kept).toBe(state.workingDirectory);
      expect(context.manager.state()).toBeNull();
      expect(await readFile(state.localPath, 'utf8')).toBe('my saved work');
      expect(JSON.parse(await readFile(join(kept!, 'origin.json'), 'utf8')).remote.path).toBe(
        '/remote/config.sh',
      );
    } finally {
      await context.dispose();
    }
  });
  it('keeps editor-launch failures recoverable and discards only the generated working directory', async () => {
    const context = await fixture();
    try {
      await writeFile(join(context.root, 'unrelated.txt'), 'keep');
      context.launch.mockRejectedValueOnce(new Error('No association'));
      await context.ready();
      expect(context.manager.state()?.error).toBe('editor-launch-failed');
      const state = context.manager.state()!;
      await expect(context.manager.start(request)).rejects.toMatchObject({ code: 'editor-busy' });
      await context.manager.reopen();
      expect(context.manager.state()?.error).toBeNull();
      await context.manager.finish('discard');
      await expect(lstat(state.workingDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readFile(join(context.root, 'unrelated.txt'), 'utf8')).toBe('keep');
    } finally {
      await context.dispose();
    }
  });
  it('keeps pending local changes through conflicts and blocks blind retries after uncertain uploads', async () => {
    const context = await fixture();
    try {
      await context.ready();
      await writeFile(context.manager.state()!.localPath, 'edited text');
      await context.manager.upload();
      context.jobs[0]!.state = 'conflict';
      context.manager.syncFromQueue();
      expect(context.manager.state()?.phase).toBe('conflict');
      await expect(context.manager.finish('discard')).rejects.toMatchObject({ code: 'busy' });
      context.jobs[0]!.state = 'uncertain';
      context.jobs[0]!.error = 'uncertain';
      context.jobs[0]!.backupPath = '/remote/recovery.bak';
      context.manager.syncFromQueue();
      await vi.waitFor(() => expect(context.manager.busy).toBe(false));
      expect(context.manager.state()?.phase).toBe('uncertain');
      await context.manager.reopen();
      await expect(context.manager.upload()).rejects.toMatchObject({ code: 'uncertain' });
      expect(context.manager.state()?.changed).toBe(true);
      expect(context.manager.state()?.error).toBe('uncertain');
    } finally {
      await context.dispose();
    }
  });
  it('never launches binary content as an editor document', async () => {
    const context = await fixture(Buffer.from([0, 1, 2, 3]));
    try {
      await context.manager.start(request);
      await vi.waitFor(() => expect(context.manager.state()?.phase).toBe('failed'));
      expect(context.manager.state()?.error).toBe('editor-text-only');
      expect(context.launch).not.toHaveBeenCalled();
      expect((await readdir(context.manager.state()!.workingDirectory)).length).toBeGreaterThan(0);
    } finally {
      await context.dispose();
    }
  });
});

describe('remote edit trust boundaries', () => {
  it('accepts bounded UTF-8 and rejects binary, invalid UTF-8, oversized text and forged requests', () => {
    validateEditText(Buffer.from('বাংলা 😀\tline\r\n'));
    for (const bytes of [
      Buffer.from([0]),
      Buffer.from([0xff]),
      Buffer.from([27]),
      Buffer.alloc(REMOTE_EDIT_MAX_BYTES + 1),
    ])
      expect(() => validateEditText(bytes)).toThrow('editor-text-only');
    expect(validRemoteEditRequest(request)).toBe(true);
    for (const value of [
      null,
      { ...request, name: '../escape' },
      { ...request, localPath: '/tmp/forged' },
      { ...request, remoteDirectory: 'relative' },
      { ...request, sessionId: 'unowned' },
    ])
      expect(validRemoteEditRequest(value)).toBe(false);
  });
  it.skipIf(process.platform === 'win32')(
    'refuses a symlink in place of its working copy',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'mterminal-edit-link-'));
      try {
        await writeFile(join(root, 'target'), 'private text');
        await symlink('target', join(root, 'editing.txt'));
        await expect(readEditCopy(join(root, 'editing.txt'))).rejects.toBeDefined();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
