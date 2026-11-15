import { argumentCompletions } from './argument-completion.js';
import type { PathCompletion } from '../../../../shared/path-completion.js';
import type { Snippet } from '../../../../shared/snippets.js';
import { isRecordableCommand, type CommandHistoryEntry } from '../../../../shared/history.js';

export const SUGGESTION_LIMIT = 20;
export const SUGGESTION_ROW_HEIGHT = 24;
/** Rows visible before the list scrolls. */
export const SUGGESTION_VISIBLE_ROWS = 6;
const LIST_PADDING = 8;

export type AutocompleteSuggestion =
  | { id: string; command: string; kind: 'history' }
  | { id: string; command: string; kind: 'argument'; description: string }
  | { id: string; command: string; kind: 'snippet'; name: string; folder: string }
  | { id: string; command: string; kind: 'path'; directory: boolean; prompt: number };

/** Preserve snippet/history priority, then offer argument and path hints. */
export function autocompleteMatches(
  entries: CommandHistoryEntry[],
  prefix: string,
  snippets: Snippet[] = [],
  paths: PathCompletion[] = [],
): AutocompleteSuggestion[] {
  if (!prefix || /^\s/u.test(prefix)) return [];
  const eligible = (command: string) =>
    command.startsWith(prefix) &&
    command.length > prefix.length &&
    isRecordableCommand(command) &&
    !Array.from(command).some(
      (c) =>
        c.charCodeAt(0) < 32 ||
        (c.charCodeAt(0) >= 127 && c.charCodeAt(0) <= 159) ||
        c.charCodeAt(0) === 0x2028 ||
        c.charCodeAt(0) === 0x2029,
    );
  const candidates: AutocompleteSuggestion[] = [
    ...snippets
      .filter((snippet) => eligible(snippet.command))
      .sort(
        (a, b) =>
          a.folder.localeCompare(b.folder) ||
          a.name.localeCompare(b.name) ||
          a.id.localeCompare(b.id),
      )
      .map(({ id, command, name, folder }) => ({
        id,
        command,
        name,
        folder,
        kind: 'snippet' as const,
      })),
    ...entries
      .filter((entry) => eligible(entry.command))
      .map(({ id, command }) => ({ id, command, kind: 'history' as const })),
    ...argumentCompletions(prefix)
      .filter((entry) => eligible(entry.command))
      .map(({ command, description }) => ({
        id: command,
        command,
        description,
        kind: 'argument' as const,
      })),
    ...paths
      .filter((entry) => eligible(entry.command))
      .map(({ command, directory, prompt }) => ({
        id: command,
        command,
        directory,
        prompt,
        kind: 'path' as const,
      })),
  ];
  const seen = new Set<string>();
  return candidates
    .filter((entry) => {
      if (seen.has(entry.command)) return false;
      seen.add(entry.command);
      return true;
    })
    .slice(0, SUGGESTION_LIMIT);
}

/** Revalidation prevents inserting a snippet edited/deleted after its popup was shown. */
export function currentSnippetSuggestion(item: AutocompleteSuggestion, snippets: Snippet[]) {
  return (
    item.kind === 'snippet' &&
    snippets.some(
      (snippet) =>
        snippet.id === item.id &&
        snippet.command === item.command &&
        snippet.name === item.name &&
        snippet.folder === item.folder,
    )
  );
}

export function currentArgumentSuggestion(item: AutocompleteSuggestion, prefix: string) {
  return (
    item.kind === 'argument' &&
    argumentCompletions(prefix).some(
      (entry) => entry.command === item.command && entry.description === item.description,
    )
  );
}

export function currentPathSuggestion(item: AutocompleteSuggestion, paths: PathCompletion[]) {
  return (
    item.kind === 'path' &&
    paths.some(
      (path) =>
        path.command === item.command &&
        path.directory === item.directory &&
        path.prompt === item.prompt,
    )
  );
}

/** Places the list beneath the cursor, or above it when there is no room below. */
export function autocompletePosition(
  cursor: { left: number; top: number; rowHeight: number },
  host: { width: number; height: number },
  count: number,
) {
  if (host.width < 80 || host.height < 44 || count < 1) return undefined;
  const width = Math.min(320, host.width - 16);
  const maxHeight = Math.min(
    Math.min(count, SUGGESTION_VISIBLE_ROWS) * SUGGESTION_ROW_HEIGHT + LIST_PADDING,
    host.height - 8,
  );
  const below = cursor.top + cursor.rowHeight + 2;
  return {
    width,
    maxHeight,
    left: Math.max(8, Math.min(cursor.left, host.width - width - 8)),
    top: below + maxHeight <= host.height - 4 ? below : Math.max(4, cursor.top - maxHeight - 2),
  };
}
