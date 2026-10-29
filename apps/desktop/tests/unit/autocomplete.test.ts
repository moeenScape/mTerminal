import { describe, expect, it } from 'vitest';
import {
  autocompleteMatches,
  autocompletePosition,
} from '../../src/renderer/src/features/workspace/autocomplete.js';

describe('command autocomplete', () => {
  it('offers five single-line suffix matches without changing ranked order', () => {
    const entries = [
      'ls',
      'ls -l',
      'ls\npwd',
      'echo ls',
      'ls -a',
      'ls -h',
      'ls -t',
      'ls -r',
      'ls -S',
    ].map((command, index) => ({
      id: String(index),
      command,
      directory: '/',
      lastUsed: 1,
      uses: 1,
    }));
    expect(autocompleteMatches(entries, 'ls').map((entry) => entry.command)).toEqual([
      'ls -l',
      'ls -a',
      'ls -h',
      'ls -t',
      'ls -r',
    ]);
  });
  it('opens beneath the cursor and stays inside narrow or bottom-edge terminals', () => {
    expect(
      autocompletePosition({ left: 20, top: 20, rowHeight: 18 }, { width: 800, height: 500 }, 5),
    ).toMatchObject({ left: 20, top: 42, width: 380 });
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
