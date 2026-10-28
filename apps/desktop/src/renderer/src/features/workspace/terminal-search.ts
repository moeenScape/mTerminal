import type { SearchAddon, ISearchResultChangeEvent, ISearchOptions } from '@xterm/addon-search';
import type { Terminal } from '@xterm/xterm';

export const MAX_SEARCH_QUERY = 256;
export const SEARCH_HIGHLIGHT_LIMIT = 1000;
export interface SearchSummary {
  index: number;
  count: number;
  error?: boolean;
}
type SearchProvider = Pick<
  SearchAddon,
  'findNext' | 'findPrevious' | 'clearDecorations' | 'onDidChangeResults'
>;
export class TerminalSearch {
  private active = false;
  private disposed = false;
  private readonly subscription: { dispose: () => void };
  constructor(
    private readonly provider: SearchProvider,
    private readonly terminal: Pick<Terminal, 'clearSelection'>,
    private readonly report: (summary: SearchSummary) => void,
  ) {
    this.subscription = provider.onDidChangeResults((event: ISearchResultChangeEvent) => {
      if (this.active && !this.disposed)
        report({ index: event.resultIndex, count: event.resultCount });
    });
  }
  find(query: string, caseSensitive: boolean, previous = false, incremental = false): void {
    if (this.disposed) return;
    this.active = true;
    if (!query || query.length > MAX_SEARCH_QUERY) {
      this.provider.clearDecorations();
      this.terminal.clearSelection();
      this.report({
        index: -1,
        count: 0,
        ...(query.length > MAX_SEARCH_QUERY ? { error: true } : {}),
      });
      return;
    }
    const options: ISearchOptions = {
      regex: false,
      wholeWord: false,
      caseSensitive,
      incremental,
      decorations: {
        matchBorder: '#b97820',
        matchOverviewRuler: '#b97820',
        activeMatchBorder: '#258771',
        activeMatchColorOverviewRuler: '#258771',
      },
    };
    try {
      const found = previous
        ? this.provider.findPrevious(query, options)
        : this.provider.findNext(query, options);
      if (!found) this.report({ index: -1, count: 0 });
    } catch {
      this.report({ index: -1, count: 0, error: true });
    }
  }
  close(): void {
    this.active = false;
    this.provider.clearDecorations();
    this.terminal.clearSelection();
    this.report({ index: -1, count: 0 });
  }
  dispose(): void {
    this.active = false;
    this.disposed = true;
    this.subscription.dispose();
    this.provider.clearDecorations();
  }
}
export function searchSummary(query: string, result: SearchSummary): string {
  if (!query) return 'Enter text to search';
  if (result.error) return 'Search unavailable. Try a shorter query.';
  if (!result.count) return 'No matches';
  if (result.count >= SEARCH_HIGHLIGHT_LIMIT)
    return `At least ${SEARCH_HIGHLIGHT_LIMIT.toLocaleString('en-US')} matches`;
  return result.index < 0 ? `${result.count} matches` : `${result.index + 1} of ${result.count}`;
}
