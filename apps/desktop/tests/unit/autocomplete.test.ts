import { describe, expect, it } from 'vitest';
import {
  SUGGESTION_LIMIT,
  SUGGESTION_ROW_HEIGHT,
  SUGGESTION_VISIBLE_ROWS,
  autocompleteMatches,
  autocompletePosition,
  currentSnippetSuggestion,
  currentPathSuggestion,
} from '../../src/renderer/src/features/workspace/autocomplete.js';

const entry = (command: string, index: number) => ({
  id: String(index),
  command,
  directory: '/',
  lastUsed: 1,
  uses: 1,
  source: 'saved' as const,
});

describe('command autocomplete', () => {
  it('offers single-line suffix matches without changing ranked order', () => {
    const entries = ['ls', 'ls -l', 'ls\npwd', 'echo ls', 'ls -a', 'ls -h'].map(entry);
    expect(autocompleteMatches(entries, 'ls').map((item) => item.command)).toEqual([
      'ls -l',
      'ls -a',
      'ls -h',
    ]);
  });
  it('caps the list so it stays quick to scan', () => {
    const entries = Array.from({ length: 40 }, (_, index) => entry(`git log -${index}`, index));
    expect(autocompleteMatches(entries, 'git')).toHaveLength(SUGGESTION_LIMIT);
  });
  it('opens beneath the cursor, scrolls past six rows and stays inside the terminal', () => {
    const below = autocompletePosition(
      { left: 20, top: 20, rowHeight: 18 },
      { width: 800, height: 500 },
      12,
    )!;
    expect(below).toMatchObject({ left: 20, top: 40, width: 320 });
    expect(below.maxHeight).toBe(SUGGESTION_VISIBLE_ROWS * SUGGESTION_ROW_HEIGHT + 8);
    const narrow = autocompletePosition(
      { left: 290, top: 180, rowHeight: 18 },
      { width: 300, height: 200 },
      5,
    )!;
    expect(narrow.left).toBeGreaterThanOrEqual(8);
    expect(narrow.left + narrow.width).toBeLessThanOrEqual(292);
    expect(narrow.top + narrow.maxHeight).toBeLessThanOrEqual(196);
    expect(
      autocompletePosition({ left: 0, top: 0, rowHeight: 18 }, { width: 0, height: 0 }, 5),
    ).toBeUndefined();
  });
});

const snippet = (command: string, index = 0) => ({
  id: `snippet-${index}`,
  command,
  name: `Snippet ${index}`,
  folder: 'Work',
  tags: [],
});

describe('snippet autocomplete source', () => {
  it('puts snippets first, deduplicates commands across sources and preserves relative history rank', () => {
    const history = ['git log --oneline', 'git status --short', 'git log -5', 'git log -5'].map(
      entry,
    );
    const snippets = [
      snippet('git status --short', 1),
      snippet('git log --oneline', 0),
      snippet('git log --oneline', 2),
    ];
    const original = JSON.stringify(snippets);
    expect(
      autocompleteMatches(history, 'git', snippets).map((item) => [item.kind, item.command]),
    ).toEqual([
      ['snippet', 'git log --oneline'],
      ['snippet', 'git status --short'],
      ['history', 'git log -5'],
    ]);
    expect(JSON.stringify(snippets)).toBe(original);
  });
  it('matches literal command prefixes rather than aliases and never includes control input', () => {
    const snippets = [
      snippet('git status', 0),
      snippet('git status\npwd', 1),
      snippet('git\tstatus', 2),
      snippet('git status\x1b[201~', 3),
      snippet('git status\x85', 4),
      snippet('git status\u2028pwd', 5),
      snippet('g'.repeat(4097), 6),
      { ...snippet('echo safe', 7), name: 'git' },
      snippet('git login password=private', 8),
    ];
    expect(autocompleteMatches([], 'git', snippets).map((item) => item.command)).toEqual([
      'git status',
    ]);
    expect(autocompleteMatches([], 'git status', snippets)).toEqual([]);
    expect(autocompleteMatches([], 'GIT', snippets)).toEqual([]);
    for (const prefix of ['', ' ', '\t', ' git'])
      expect(autocompleteMatches([], prefix, snippets)).toEqual([]);
  });
  it('keeps mixed-source results bounded and sorts curated entries by folder and name', () => {
    const snippets = [
      { ...snippet('echo Z', 0), folder: 'Z' },
      { ...snippet('echo B', 1), name: 'B' },
      { ...snippet('echo A', 2), name: 'A' },
    ];
    expect(autocompleteMatches([], 'echo', snippets).map((item) => item.command)).toEqual([
      'echo A',
      'echo B',
      'echo Z',
    ]);
    expect(
      autocompleteMatches(
        Array.from({ length: 40 }, (_, n) => entry(`echo H${n}`, n)),
        'echo',
        snippets,
      ),
    ).toHaveLength(SUGGESTION_LIMIT);
  });
  it('revalidates the identity, command and displayed label before insertion', () => {
    const saved = snippet('git status --short');
    const item = autocompleteMatches([], 'git', [saved])[0]!;
    expect(currentSnippetSuggestion(item, [saved])).toBe(true);
    for (const changed of [
      { ...saved, id: 'other' },
      { ...saved, command: 'git status --long' },
      { ...saved, name: 'Renamed' },
      { ...saved, folder: 'Other' },
    ])
      expect(currentSnippetSuggestion(item, [changed])).toBe(false);
    expect(currentSnippetSuggestion(item, [])).toBe(false);
    expect(
      currentSnippetSuggestion(autocompleteMatches([entry('git status', 0)], 'git')[0]!, [saved]),
    ).toBe(false);
  });
});

it('appends insert-only path results without replacing ranked history or exceeding the shared limit', () => {
  const paths = [
    { command: 'cat ./folder/', directory: true, prompt: 1 },
    { command: 'cat ./file.txt', directory: false, prompt: 1 },
  ];
  const results = autocompleteMatches([entry('cat ./file.txt', 1)], 'cat ./', [], paths);
  expect(results.map((item) => [item.kind, item.command])).toEqual([
    ['history', 'cat ./file.txt'],
    ['path', 'cat ./folder/'],
  ]);
  expect(autocompleteMatches([], 'cat ./', [], paths)[0]).toMatchObject({
    kind: 'path',
    directory: true,
  });
});

it('refuses changed file types, missing paths and replacement prompt revisions', () => {
  const path = { command: 'cat ./file.txt', directory: false, prompt: 1 };
  const item = autocompleteMatches([], 'cat ./', [], [path])[0]!;
  expect(currentPathSuggestion(item, [path])).toBe(true);
  expect(currentPathSuggestion(item, [{ ...path, prompt: 2 }])).toBe(false);
  expect(currentPathSuggestion(item, [{ ...path, directory: true }])).toBe(false);
  expect(currentPathSuggestion(item, [{ ...path, command: 'cat ./other.txt' }])).toBe(false);
  expect(currentPathSuggestion(item, [])).toBe(false);
});
