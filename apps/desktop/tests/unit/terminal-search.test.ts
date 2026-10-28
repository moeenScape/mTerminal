import { describe, expect, it, vi } from 'vitest';
import type { SearchAddon } from '@xterm/addon-search';
import {
  TerminalSearch,
  searchSummary,
} from '../../src/renderer/src/features/workspace/terminal-search.js';

describe('terminal search', () => {
  it('searches literal text in either direction and clears selection when closed', () => {
    const listener: { callback?: (event: { resultIndex: number; resultCount: number }) => void } =
      {};
    const dispose = vi.fn();
    const provider = {
      findNext: vi.fn(() => true),
      findPrevious: vi.fn(() => true),
      clearDecorations: vi.fn(),
      onDidChangeResults: (
        callback: (event: { resultIndex: number; resultCount: number }) => void,
      ) => {
        listener.callback = callback;
        return { dispose };
      },
    } as unknown as SearchAddon;
    const terminal = { clearSelection: vi.fn() };
    const report = vi.fn();
    const search = new TerminalSearch(provider, terminal, report);
    search.find('a.*', true, false, true);
    expect(provider.findNext).toHaveBeenCalledWith(
      'a.*',
      expect.objectContaining({ regex: false, caseSensitive: true, incremental: true }),
    );
    listener.callback?.({ resultIndex: 1, resultCount: 3 });
    expect(report).toHaveBeenLastCalledWith({ index: 1, count: 3 });
    search.find('a.*', true, true);
    expect(provider.findPrevious).toHaveBeenCalled();
    search.close();
    expect(terminal.clearSelection).toHaveBeenCalled();
    search.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });
  it('labels empty, missing, capped and failed results', () => {
    expect(searchSummary('', { index: -1, count: 0 })).toBe('Enter text to search');
    expect(searchSummary('x', { index: -1, count: 0 })).toBe('No matches');
    expect(searchSummary('x', { index: 1, count: 3 })).toBe('2 of 3');
    expect(searchSummary('x', { index: -1, count: 1000 })).toContain('At least');
    expect(searchSummary('x', { index: -1, count: 0, error: true })).toContain('unavailable');
  });
});
