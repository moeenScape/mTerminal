export const historyChannels = {
  enabled: 'history:enabled',
  enable: 'history:enable',
  search: 'history:search',
  delete: 'history:delete',
  clear: 'history:clear',
} as const;
export const historyEvents = { changed: 'history:changed' } as const;
export interface CommandHistoryEntry {
  id: string;
  command: string;
  directory: string;
  lastUsed: number;
  uses: number;
}
export interface HistoryApi {
  onHistoryChanged: (listener: () => void) => () => void;
  getHistoryEnabled: () => Promise<boolean>;
  setHistoryEnabled: (enabled: boolean) => Promise<void>;
  searchHistory: (prefix: string, directory: string) => Promise<CommandHistoryEntry[]>;
  deleteHistory: (id: string) => Promise<void>;
  clearHistory: () => Promise<void>;
}
