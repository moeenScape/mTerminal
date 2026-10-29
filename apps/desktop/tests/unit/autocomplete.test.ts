import { describe, expect, it } from 'vitest';
import {
  SUGGESTION_LIMIT,
  SUGGESTION_ROW_HEIGHT,
  SUGGESTION_VISIBLE_ROWS,
  autocompleteMatches,
  autocompletePosition,
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
