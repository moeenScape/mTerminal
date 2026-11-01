import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { autocompleteMatches } from '../../src/renderer/src/features/workspace/autocomplete.js';
import {
  BashHistoryFile,
  bashHistoryPath,
  mergeHistory,
  parseBashHistory,
} from '../../src/main/terminal/native-history.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return { ...actual, open: vi.fn(actual.open) };
});

describe('Bash history file', () => {
  it('lists unique commands newest first and skips timestamps, blanks and secrets', () => {
    const content = [
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

  it('preserves timestamped multiline commands and never offers their fragments', () => {
    const content = [
      'echo incomplete',
      '#1700000000',
      'ls -la',
      '#1700000001',
      "cat <<'EOF'",
      'echo heredoc-content',
      'EOF',
      '#1700000002',
      'echo latest',
      '',
    ].join('\n');
    const commands = parseBashHistory(content);
    expect(commands).toEqual(['echo latest', "cat <<'EOF'\necho heredoc-content\nEOF", 'ls -la']);
    expect(autocompleteMatches(mergeHistory([], commands, 'cat', 'prefix'), 'cat')).toEqual([]);
    expect(mergeHistory([], commands, 'echo', 'prefix').map((entry) => entry.command)).toEqual([
      'echo latest',
    ]);
  });

  it('keeps saved results available when opening the native file fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mterminal-bash-history-'));
    const path = join(directory, 'history');
    try {
      await writeFile(path, 'ls\n');
      const denied = vi.mocked(fs.open).mockRejectedValueOnce(new Error('Permission denied'));
      try {
        const commands = await new BashHistoryFile(path).commands();
        expect(commands).toEqual([]);
        const saved = {
          id: 'a',
          command: 'ls -l',
          directory: '/',
          lastUsed: 1,
          uses: 1,
          source: 'saved' as const,
        };
        expect(mergeHistory([saved], commands, 'ls', 'prefix')).toEqual([saved]);
      } finally {
        denied.mockRestore();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
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
