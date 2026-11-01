import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { validFileName } from '../../src/shared/files.js';
import { mutateLocalDirectory, validMutationRequest } from '../../src/main/files/operations.js';
import { TerminalRegistry } from '../../src/main/terminal/registry.js';
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, unlink: vi.fn(actual.unlink) };
});

describe('file operation boundaries', () => {
  it('accepts one child name and validates every operation payload', () => {
    const location = {
      side: 'remote',
      path: '/home/user',
      sessionId: '04e9f162-d3cd-4c8f-a70a-2323a1751a9b',
    };
    for (const operation of [
      { action: 'mkdir', name: 'বাংলা folder' },
      { action: 'rename', name: 'before', newName: 'after' },
      { action: 'delete', name: 'item' },
      { action: 'chmod', name: 'item', mode: '0644' },
    ])
      expect(validMutationRequest({ ...location, operation })).toBe(true);
    for (const name of [
      '',
      ' ',
      '.',
      '..',
      '../escape',
      '/root',
      'nested/child',
      'bad\\name',
      'bad\0',
      'bad\n',
      'x'.repeat(256),
    ])
      expect(validFileName(name)).toBe(false);
    for (const operation of [
      { action: 'chmod', name: 'item', mode: '888' },
      { action: 'delete', name: 'item', recursive: true },
      { action: 'rename', name: 'same', newName: 'same' },
      { action: 'rename', name: 'before', newName: '../escape' },
      { action: 'mkdir', name: '.' },
    ])
      expect(validMutationRequest({ ...location, operation })).toBe(false);
    expect(
      validMutationRequest({
        ...location,
        path: '',
        operation: { action: 'mkdir', name: 'folder' },
      }),
    ).toBe(false);
  });
  it('rejects mutation of missing or unowned terminal sessions', async () => {
    const registry = new TerminalRegistry(() => {});
    await expect(
      registry.mutateDirectory('04e9f162-d3cd-4c8f-a70a-2323a1751a9b', '/', {
        action: 'delete',
        name: 'item',
      }),
    ).rejects.toMatchObject({ code: 'disconnected' });
    registry.dispose();
  });
});

describe('local file operations', () => {
  it('reports a partial rename without deleting either name when unlink fails', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'mterminal-file-partial-'));
    try {
      await writeFile(join(parent, 'source'), 'keep');
      vi.mocked(unlink).mockRejectedValueOnce(new Error('unlink failed'));
      await expect(
        mutateLocalDirectory(parent, { action: 'rename', name: 'source', newName: 'destination' }),
      ).rejects.toMatchObject({ code: 'partial' });
      expect(await readFile(join(parent, 'source'), 'utf8')).toBe('keep');
      expect(await readFile(join(parent, 'destination'), 'utf8')).toBe('keep');
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
  it('creates and renames folders and files, preserves collisions and refuses nonempty deletion', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'mterminal-file-ops-'));
    try {
      await mutateLocalDirectory(parent, { action: 'mkdir', name: 'folder' });
      await writeFile(join(parent, 'folder', 'keep.txt'), 'preserve');
      await expect(
        mutateLocalDirectory(parent, { action: 'delete', name: 'folder' }),
      ).rejects.toMatchObject({ code: expect.stringMatching(/ENOTEMPTY|EEXIST/) });
      expect(await readFile(join(parent, 'folder', 'keep.txt'), 'utf8')).toBe('preserve');
      await writeFile(join(parent, 'source'), 'source contents');
      await writeFile(join(parent, 'existing'), 'destination contents');
      await expect(
        mutateLocalDirectory(parent, { action: 'rename', name: 'source', newName: 'existing' }),
      ).rejects.toMatchObject({ code: 'EEXIST' });
      expect(await readFile(join(parent, 'existing'), 'utf8')).toBe('destination contents');
      expect(await readFile(join(parent, 'source'), 'utf8')).toBe('source contents');
      await mutateLocalDirectory(parent, { action: 'rename', name: 'source', newName: 'renamed' });
      expect(await readFile(join(parent, 'renamed'), 'utf8')).toBe('source contents');
      await mutateLocalDirectory(parent, { action: 'delete', name: 'renamed' });
      await mutateLocalDirectory(parent, { action: 'mkdir', name: 'empty' });
      await expect(
        mutateLocalDirectory(parent, { action: 'rename', name: 'folder', newName: 'empty' }),
      ).rejects.toMatchObject({ code: 'EEXIST' });
      if (process.platform !== 'win32') {
        await mutateLocalDirectory(parent, { action: 'rename', name: 'folder', newName: 'moved' });
        expect(await readFile(join(parent, 'moved', 'keep.txt'), 'utf8')).toBe('preserve');
      }
      await mutateLocalDirectory(parent, { action: 'delete', name: 'empty' });
      expect(await readdir(parent)).not.toContain('renamed');
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
  it.skipIf(process.platform === 'win32')(
    'changes modes without following links and deletes only the link',
    async () => {
      const parent = await mkdtemp(join(tmpdir(), 'mterminal-file-modes-'));
      try {
        await writeFile(join(parent, 'target'), 'keep target');
        await mutateLocalDirectory(parent, { action: 'chmod', name: 'target', mode: '0600' });
        expect((await lstat(join(parent, 'target'))).mode & 0o7777).toBe(0o600);
        await symlink('target', join(parent, 'alias'));
        await expect(
          mutateLocalDirectory(parent, { action: 'chmod', name: 'alias', mode: '0777' }),
        ).rejects.toMatchObject({ code: 'unsupported' });
        await mutateLocalDirectory(parent, {
          action: 'rename',
          name: 'alias',
          newName: 'renamed-link',
        });
        expect((await lstat(join(parent, 'renamed-link'))).isSymbolicLink()).toBe(true);
        await mutateLocalDirectory(parent, { action: 'delete', name: 'renamed-link' });
        expect(await readFile(join(parent, 'target'), 'utf8')).toBe('keep target');
        expect((await lstat(join(parent, 'target'))).mode & 0o7777).toBe(0o600);
      } finally {
        await rm(parent, { recursive: true, force: true });
      }
    },
  );
});
