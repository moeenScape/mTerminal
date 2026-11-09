import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  fileErrorCode,
  listLocalDirectory,
  validFileRequest,
} from '../../src/main/files/listing.js';
import {
  visibleFiles,
  fileDropRequest,
  type FileDrag,
  rememberDirectory,
  symbolicPermissions,
  fileKindLabel,
} from '../../src/renderer/src/features/files/file-browser.js';
import { TerminalRegistry } from '../../src/main/terminal/registry.js';

describe('read-only file browser', () => {
  it('lists metadata and preserves hidden, Unicode and symlink names without following links', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mterminal-files-'));
    try {
      await mkdir(join(directory, 'folder'));
      await writeFile(join(directory, '.hidden'), 'hidden');
      await writeFile(join(directory, 'বাংলা file.txt'), 'abc');
      if (process.platform !== 'win32') await symlink('folder', join(directory, 'folder link'));
      const result = await listLocalDirectory(directory);
      const canonical = await realpath(directory);
      expect(result.path).toBe(canonical);
      expect(result.parent).toBe(dirname(canonical));
      expect(result.breadcrumbs.at(-1)?.path).toBe(canonical);
      expect(result.entries.find((entry) => entry.name === 'বাংলা file.txt')).toMatchObject({
        kind: 'file',
        size: 3,
        path: join(canonical, 'বাংলা file.txt'),
      });
      if (process.platform !== 'win32')
        expect(result.entries.find((entry) => entry.name === 'folder link')?.kind).toBe('symlink');
      expect(
        visibleFiles(result.entries, false, 'name', false).some(
          (entry) => entry.name === '.hidden',
        ),
      ).toBe(false);
      expect(visibleFiles(result.entries, true, 'name', true)[0]?.kind).toBe('directory');
      expect(
        visibleFiles(result.entries, true, 'size', false)
          .filter((entry) => entry.kind === 'file')
          .map((entry) => entry.size),
      ).toEqual([3, 6]);
      const child = await listLocalDirectory(join(directory, 'folder'));
      expect(child.entries).toEqual([]);
      expect(child.parent).toBe(result.path);
      expect(
        fileErrorCode(
          await listLocalDirectory(join(directory, 'absent')).catch((error: unknown) => error),
        ),
      ).toBe('missing');
      expect(
        fileErrorCode(
          await listLocalDirectory(join(directory, '.hidden')).catch((error: unknown) => error),
        ),
      ).toBe('directory');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not browse a session missing from the window registry', async () => {
    const registry = new TerminalRegistry(() => {});
    await expect(
      registry.listDirectory('04e9f162-d3cd-4c8f-a70a-2323a1751a9b', '/'),
    ).rejects.toMatchObject({ code: 'disconnected' });
    registry.dispose();
  });

  it('rejects malformed, relative, NUL-containing and unowned session requests', () => {
    const sessionId = '04e9f162-d3cd-4c8f-a70a-2323a1751a9b';
    expect(validFileRequest({ side: 'local', path: '' })).toBe(true);
    expect(validFileRequest({ side: 'remote', sessionId, path: '/home/user' })).toBe(true);
    for (const request of [
      null,
      [],
      { side: 'local', path: 'relative' },
      { side: 'local', path: '/x\0' },
      { side: 'local', path: '', extra: true },
      { side: 'remote', path: '/home', sessionId: 'bad' },
      { side: 'remote', path: '../x', sessionId },
      { side: 'local', path: '/' + 'x'.repeat(4096) },
    ]) {
      expect(validFileRequest(request)).toBe(false);
    }
    expect(fileErrorCode({ code: 'EACCES' })).toBe('permission');
    expect(fileErrorCode({ code: 3 })).toBe('permission');
  });
});

describe('file-pane drag transfers', () => {
  const context = {
    sessionId: '04e9f162-d3cd-4c8f-a70a-2323a1751a9b',
    title: 'SSH fixture',
    localDirectory: '/local',
    remoteDirectory: '/remote',
  };
  const local: FileDrag = {
    token: 'internal-token',
    sessionId: context.sessionId,
    side: 'local',
    directory: '/local',
    entry: {
      name: 'বাংলা file.txt',
      path: '/local/বাংলা file.txt',
      kind: 'file',
      size: 3,
      modified: 1,
      permissions: '0600',
    },
  };
  it('previews uploads and downloads using the current opposite folder', () => {
    expect(fileDropRequest(local, 'remote', context)).toEqual({
      ...context,
      name: local.entry.name,
      direction: 'upload',
    });
    const remote = {
      ...local,
      side: 'remote' as const,
      directory: '/remote',
      entry: { ...local.entry, path: '/remote/বাংলা file.txt' },
    };
    expect(fileDropRequest(remote, 'local', { ...context, localDirectory: '/chosen' })).toEqual({
      ...context,
      localDirectory: '/chosen',
      name: local.entry.name,
      direction: 'download',
    });
  });
  it('refuses same-side, missing, disconnected, stale-source and non-file selections', () => {
    expect(fileDropRequest(null, 'remote', context)).toBeNull();
    expect(fileDropRequest(local, 'remote', null)).toBeNull();
    expect(fileDropRequest(local, 'local', context)).toBeNull();
    expect(
      fileDropRequest(local, 'remote', { ...context, sessionId: 'different-session' }),
    ).toBeNull();
    expect(fileDropRequest(local, 'remote', { ...context, localDirectory: '/changed' })).toBeNull();
    for (const kind of ['directory', 'symlink', 'other'] as const)
      expect(
        fileDropRequest({ ...local, entry: { ...local.entry, kind } }, 'remote', context),
      ).toBeNull();
    expect(
      fileDropRequest(
        { ...local, entry: { ...local.entry, name: '../escape' } },
        'remote',
        context,
      ),
    ).toBeNull();
  });
});

describe('compact file-list controls', () => {
  it('filters names without changing entries and sorts kinds with folders first', () => {
    const base = { size: 1, modified: 1, permissions: '0644' };
    const entries = [
      { ...base, name: 'Report.TXT', path: '/Report.TXT', kind: 'file' as const },
      { ...base, name: 'archive.zip', path: '/archive.zip', kind: 'file' as const },
      { ...base, name: '.report', path: '/.report', kind: 'file' as const },
      { ...base, name: 'folder', path: '/folder', kind: 'directory' as const },
    ];
    expect(
      visibleFiles(entries, false, 'name', false, 'REPORT').map((entry) => entry.name),
    ).toEqual(['Report.TXT']);
    expect(visibleFiles(entries, true, 'name', false, 'report').map((entry) => entry.name)).toEqual(
      ['.report', 'Report.TXT'],
    );
    expect(visibleFiles(entries, false, 'kind', true).map((entry) => entry.name)).toEqual([
      'folder',
      'archive.zip',
      'Report.TXT',
    ]);
    expect(entries[0]?.name).toBe('Report.TXT');
    expect(fileKindLabel({ name: '.env', kind: 'file' })).toBe('File');
    expect(fileKindLabel({ name: 'target', kind: 'symlink' })).toBe('Link');
  });
  it('records successful canonical navigation, reuses back/forward entries and truncates forward history on a new branch', () => {
    let history = { paths: [] as string[], index: -1 };
    for (const path of ['/home', '/home/one', '/home/two'])
      history = rememberDirectory(history, path);
    expect(rememberDirectory(history, '/home/two')).toBe(history);
    history = rememberDirectory(history, '/home/one', 1);
    expect(history).toEqual({ paths: ['/home', '/home/one', '/home/two'], index: 1 });
    expect(rememberDirectory(history, '/home/two', 2).index).toBe(2);
    history = rememberDirectory(history, '/other');
    expect(history).toEqual({ paths: ['/home', '/home/one', '/other'], index: 2 });
    for (let i = 0; i < 80; i++) history = rememberDirectory(history, `/folder-${i}`);
    expect(history.paths).toHaveLength(64);
    expect(history.paths[history.index]).toBe('/folder-79');
  });
  it.each([
    ['0755', 'directory', 'drwxr-xr-x'],
    ['0644', 'file', '-rw-r--r--'],
    ['0600', 'symlink', 'lrw-------'],
    ['4755', 'file', '-rwsr-xr-x'],
    ['4644', 'file', '-rwSr--r--'],
    ['1777', 'directory', 'drwxrwxrwt'],
  ] as const)('formats %s permissions without losing special bits', (mode, kind, expected) => {
    expect(symbolicPermissions(mode, kind)).toBe(expected);
  });
});
