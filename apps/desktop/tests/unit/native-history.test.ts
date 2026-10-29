import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BashHistoryFile,
  bashHistoryPath,
  mergeHistory,
  parseBashHistory,
} from '../../src/main/terminal/native-history.js';

describe('Bash history file', () => {
  it('lists unique commands newest first and skips timestamps, blanks and secrets', () => {
    const content = [
      '#1700000000',
      'ls -la',
      'git status',
      '',
      ' echo hidden',
      'export API_KEY=abc',
      'ls -la',
      'npm test',
    ].join('\n');
    expect(parseBashHistory(content)).toEqual(['npm test', 'ls -la', 'git status']);
  });

  it('uses $HISTFILE when set', () => {
    expect(bashHistoryPath({ HISTFILE: '/tmp/custom' })).toBe('/tmp/custom');
    expect(bashHistoryPath({})).toMatch(/\.bash_history$/);
  });

  it('reads only the end of large files and notices changes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mterminal-bash-history-'));
    const path = join(directory, 'history');
    try {
      expect(await new BashHistoryFile(path).commands()).toEqual([]);
      const filler = Array.from({ length: 40000 }, (_, index) => `echo line-${index}`);
      await writeFile(path, [...filler, 'echo newest'].join('\n'));
      const file = new BashHistoryFile(path);
      const commands = await file.commands();
      expect(commands[0]).toBe('echo newest');
      expect(commands).not.toContain('echo line-0');
      await writeFile(path, 'echo replaced\n');
      expect(await file.commands()).toEqual(['echo replaced']);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('lists saved commands first and adds Bash history without duplicates', () => {
    const saved = [
      {
        id: 'a',
        command: 'git push',
        directory: '/',
        lastUsed: 2,
        uses: 1,
        source: 'saved' as const,
      },
    ];
    const merged = mergeHistory(saved, ['git pull', 'git push', 'ls'], 'git', 'prefix');
    expect(merged.map((item) => [item.command, item.source])).toEqual([
      ['git push', 'saved'],
      ['git pull', 'bash'],
    ]);
    expect(mergeHistory([], ['git pull', 'ls'], 'PULL', 'contains')).toHaveLength(1);
    expect(mergeHistory([], ['git pull'], 'PULL', 'prefix')).toHaveLength(0);
  });
});
