import { describe, expect, it } from 'vitest';
import { argumentCompletions } from '../../src/renderer/src/features/workspace/argument-completion.js';
import {
  autocompleteMatches,
  currentArgumentSuggestion,
} from '../../src/renderer/src/features/workspace/autocomplete.js';

describe('static command argument suggestions', () => {
  it('offers supported subcommands and standalone flags while preserving the typed prefix', () => {
    for (const [prefix, expected] of [
      ['git st', 'git status'],
      ['git l', 'git log'],
      ['git --v', 'git --version'],
      ['git status --sh', 'git status --short'],
      ['git log --o', 'git log --oneline'],
      ['git diff --ca', 'git diff --cached'],
      ['git show --na', 'git show --name-only'],
      ['git branch --r', 'git branch --remotes'],
      ['npm i', 'npm install'],
      ['npm install --save-d', 'npm install --save-dev'],
      ['npm ci --no-a', 'npm ci --no-audit'],
      ['npm run --if', 'npm run --if-present'],
      ['npm test --sil', 'npm test --silent'],
      ['ls -', 'ls -a'],
      ['git  status   --sh', 'git  status   --short'],
    ]) {
      const matches = argumentCompletions(prefix!);
      expect(matches.map((entry) => entry.command)).toContain(expected);
      for (const entry of matches) {
        expect(entry.command.startsWith(prefix!)).toBe(true);
        expect(entry.command.length).toBeGreaterThan(prefix!.length);
        expect(entry.command).not.toMatch(/[\r\n]/u);
        expect(entry.description).not.toBe('');
      }
    }
  });
  it('suppresses existing flags and stops at end-of-options, operands and unknown option grammar', () => {
    expect(
      argumentCompletions('git status --short --').map((entry) => entry.command),
    ).not.toContain('git status --short --short');
    expect(argumentCompletions('ls -a -').map((entry) => entry.command)).not.toContain('ls -a -a');
    for (const prefix of [
      'git status -- ',
      'git status -- --sh',
      'npm run dev -- --sil',
      'npm install package --s',
      'git log HEAD --o',
      'git log --max-count 2 --o',
      'git -C repo status --s',
      'ls -la -',
      'ls file -',
      'git status --shor ',
    ])
      expect(argumentCompletions(prefix)).toEqual([]);
  });
  it('leaves unsupported commands and shell syntax untouched', () => {
    for (const prefix of [
      '',
      'git',
      'git status',
      'Git st',
      'g st',
      '/usr/bin/git st',
      'sudo git st',
      'npm i --s',
      'git config --g',
      'constructor ',
      '__proto__ ',
      'toString ',
      ' git st',
      'git\tst',
      'git st\n',
      'git st\x1b',
      'git $CMD',
      'git `pwd`',
      "git 'st",
      'git "st',
      'git st\\',
      'git st; ls',
      'git st && ls',
      'git st | ls',
      'git st > file',
      'git *',
      'git (st)',
      'git #st',
      'git secret=value --s',
      'a'.repeat(4097),
    ])
      expect(argumentCompletions(prefix)).toEqual([]);
  });
  it('merges below history, deduplicates and revalidates exact argument hints', () => {
    const history = [
      {
        id: 'history',
        command: 'git status --short',
        directory: '/',
        lastUsed: 1,
        uses: 1,
        source: 'bash' as const,
      },
    ];
    const rows = autocompleteMatches(history, 'git status --');
    expect(rows[0]).toMatchObject({ kind: 'history', command: 'git status --short' });
    expect(rows.filter((row) => row.command === 'git status --short')).toHaveLength(1);
    const item = autocompleteMatches([], 'git status --sh')[0]!;
    expect(item).toMatchObject({ kind: 'argument', command: 'git status --short' });
    expect(currentArgumentSuggestion(item, 'git status --sh')).toBe(true);
    expect(currentArgumentSuggestion(item, 'git diff --sh')).toBe(false);
    expect(
      currentArgumentSuggestion({ ...item, command: 'git status --evil' }, 'git status --sh'),
    ).toBe(false);
    expect(
      currentArgumentSuggestion(
        { id: 'x', kind: 'argument', command: item.command, description: 'Altered' },
        'git status --sh',
      ),
    ).toBe(false);
  });
});
