import { mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { completeLocalPaths } from '../../src/main/terminal/path-completion.js';
import {
  pathCompletionContext,
  escapePathSuffix,
  PATH_COMPLETION_LIMIT,
} from '../../src/shared/path-completion.js';
async function fixture(operation: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'mterminal-paths-'));
  try {
    await operation(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
describe('literal path completion parsing', () => {
  it('supports explicit paths, argument words, escaped filenames and current-user home', () => {
    expect(pathCompletionContext('cat ./some\\ folder/fi')).toMatchObject({
      head: './some folder/',
      name: 'fi',
      directoriesOnly: false,
      home: false,
    });
    expect(pathCompletionContext('cd ../Doc')).toMatchObject({
      head: '../',
      name: 'Doc',
      directoriesOnly: true,
    });
    expect(pathCompletionContext('./bin/pr')).toMatchObject({ head: './bin/', name: 'pr' });
    expect(pathCompletionContext('cat ~/Doc')).toMatchObject({
      head: '~/',
      name: 'Doc',
      home: true,
    });
    expect(pathCompletionContext('cat \\~/fi')).toMatchObject({
      head: '~/',
      name: 'fi',
      home: false,
    });
    expect(pathCompletionContext('cat ')).toMatchObject({ head: '', name: '' });
    expect(escapePathSuffix(' space;$()\'"!#\\😀')).toBe(
      '\\ space\\;\\$\\(\\)\\\'\\"\\!\\#\\\\\\😀',
    );
  });
  it('leaves shell syntax, expansions, private input and incomplete escapes to native completion', () => {
    for (const prefix of [
      '',
      'git',
      ' cat fi',
      'cat "fi',
      "cat 'fi",
      'cat $HOME/fi',
      'cat `pwd`/fi',
      'echo x; cat fi',
      'cat *.txt',
      'cat file?',
      'cat < fi',
      'cat foo|bar',
      'cat (foo)',
      'cat #comment',
      'cat ~other/fi',
      'cat foo~bar',
      'cat fi\\',
      'cat --op',
      'cat fi\n',
      'cat token=private',
      'cat \x1b',
      'a'.repeat(4097),
    ])
      expect(pathCompletionContext(prefix)).toBeUndefined();
  });
});
describe.skipIf(process.platform === 'win32')('bounded local directory reads', () => {
  it('completes files/directories, hides dotfiles until explicit and inserts safe literal suffixes', async () => {
    await fixture(async (directory) => {
      await mkdir(join(directory, 'read folder'));
      await writeFile(join(directory, 'read.txt'), 'contents are never returned');
      await writeFile(join(directory, '.hidden'), 'private');
      await writeFile(join(directory, '-option'), 'option');
      await writeFile(join(directory, "read;$()'!.txt"), 'literal');
      const rows = await completeLocalPaths(directory, 'cat re');
      expect(rows).toContainEqual({ command: 'cat read\\ folder/', directory: true });
      expect(rows).toContainEqual({ command: 'cat read.txt', directory: false });
      expect(rows).toContainEqual({ command: "cat read\\;\\$\\(\\)\\'\\!.txt", directory: false });
      expect(JSON.stringify(rows)).not.toContain('contents are never returned');
      expect(await completeLocalPaths(directory, 'cd re')).toEqual([
        { command: 'cd read\\ folder/', directory: true },
      ]);
      expect((await completeLocalPaths(directory, 'cat ')).map((row) => row.command)).not.toContain(
        'cat .hidden',
      );
      expect(await completeLocalPaths(directory, 'cat .h')).toEqual([
        { command: 'cat .hidden', directory: false },
      ]);
      expect((await completeLocalPaths(directory, 'cat ')).map((row) => row.command)).not.toContain(
        'cat -option',
      );
      expect(await completeLocalPaths(directory, 'cat ./-op')).toEqual([
        { command: 'cat ./-option', directory: false },
      ]);
      await writeFile(join(directory, 'read folder', 'child.txt'), 'child');
      expect(await completeLocalPaths(directory, 'cat read\\ folder/ch')).toEqual([
        { command: 'cat read\\ folder/child.txt', directory: false },
      ]);
    });
  });
  it('handles absolute, parent and home paths without invoking a shell', async () => {
    await fixture(async (directory) => {
      await mkdir(join(directory, 'child'));
      await writeFile(join(directory, 'parent.txt'), 'data');
      const escaped = escapePathSuffix(directory);
      expect(await completeLocalPaths(directory, `cat ${escaped}/par`)).toEqual([
        { command: `cat ${escaped}/parent.txt`, directory: false },
      ]);
      expect(await completeLocalPaths(join(directory, 'child'), 'cat ../par')).toEqual([
        { command: 'cat ../parent.txt', directory: false },
      ]);
      expect(await completeLocalPaths(directory, 'cat ~/par', directory)).toEqual([
        { command: 'cat ~/parent.txt', directory: false },
      ]);
      expect(await completeLocalPaths(directory, 'cat ~/par')).toEqual([]);
      expect(await completeLocalPaths(directory, 'cat missing/fi')).toEqual([]);
      expect(await completeLocalPaths('relative', 'cat ./fi')).toEqual([]);
    });
  });
  it('follows directory links, ignores broken links and bounds results', async () => {
    await fixture(async (directory) => {
      await mkdir(join(directory, 'target'));
      if (process.platform !== 'win32') {
        await symlink(join(directory, 'target'), join(directory, 'linked'));
        await symlink(join(directory, 'missing'), join(directory, 'broken'));
        expect(await completeLocalPaths(directory, 'cd lin')).toEqual([
          { command: 'cd linked/', directory: true },
        ]);
        expect(await completeLocalPaths(directory, 'cat bro')).toEqual([]);
      }
      await Promise.all(
        Array.from({ length: 30 }, (_, index) => writeFile(join(directory, `entry${index}`), 'x')),
      );
      expect(await completeLocalPaths(directory, 'cat ent')).toHaveLength(PATH_COMPLETION_LIMIT);
    });
  });
});
