export const historyChannels = {
  search: 'history:search',
  delete: 'history:delete',
  clear: 'history:clear',
} as const;
export const historyEvents = { changed: 'history:changed' } as const;

/** `prefix` drives autocomplete (case-sensitive start match); `contains` drives panel search. */
export type HistorySearchMode = 'prefix' | 'contains';

/** `saved` entries live in the encrypted vault; `bash` entries are read from the shell's history file. */
export type HistorySource = 'saved' | 'bash';

export interface CommandHistoryEntry {
  id: string;
  command: string;
  directory: string;
  lastUsed: number;
  uses: number;
  source: HistorySource;
}
export interface HistoryApi {
  onHistoryChanged: (listener: () => void) => () => void;
  searchHistory: (
    query: string,
    directory: string,
    mode: HistorySearchMode,
  ) => Promise<CommandHistoryEntry[]>;
  deleteHistory: (id: string) => Promise<void>;
  clearHistory: () => Promise<void>;
}

export const HISTORY_RESULT_LIMIT: Record<HistorySearchMode, number> = {
  prefix: 20,
  contains: 200,
};

export function historyMatches(command: string, query: string, mode: HistorySearchMode) {
  return mode === 'prefix'
    ? command.startsWith(query)
    : command.toLowerCase().includes(query.toLowerCase());
}

/**
 * Commands that are never stored or offered: blank, space-prefixed (Bash's `ignorespace`
 * convention), oversized, containing control characters, or looking like they carry a secret.
 * The secret check is a convenience; it cannot catch every credential.
 */
export function isRecordableCommand(command: string) {
  return !(
    !command.trim() ||
    command.startsWith(' ') ||
    command.length > 4096 ||
    Array.from(command).some((character) => {
      const code = character.charCodeAt(0);
      return (code < 32 && code !== 10 && code !== 13) || code === 127;
    }) ||
    /(?:password|passwd|token|secret|api[_-]?key)\s*(?:=|\s)|https?:\/\/[^\s/]+:[^\s/]+@/i.test(
      command,
    )
  );
}
