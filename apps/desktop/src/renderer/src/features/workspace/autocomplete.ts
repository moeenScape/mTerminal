import type { CommandHistoryEntry } from '../../../../shared/history.js';

export const SUGGESTION_LIMIT = 20;
export const SUGGESTION_ROW_HEIGHT = 24;
/** Rows visible before the list scrolls. */
export const SUGGESTION_VISIBLE_ROWS = 6;
const LIST_PADDING = 8;

/** Single-line commands that extend the typed text, in ranked order. */
export function autocompleteMatches(entries: CommandHistoryEntry[], prefix: string) {
  return entries
    .filter(
      (entry) =>
        entry.command.startsWith(prefix) &&
        entry.command.length > prefix.length &&
        !/[\r\n]/.test(entry.command),
    )
    .slice(0, SUGGESTION_LIMIT);
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
