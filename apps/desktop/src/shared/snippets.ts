import { validHostId, validateGroupPath } from './hosts.js';
export const MAX_SNIPPETS = 200;
export const MAX_SNIPPET_COMMAND = 4096;
export const snippetChannels = {
  list: 'snippets:list',
  save: 'snippets:save',
  delete: 'snippets:delete',
} as const;
export const SNIPPETS_CHANGED = 'snippets:changed';
export interface SnippetDraft {
  name: string;
  command: string;
  folder: string;
  tags: string[];
}
export interface Snippet extends SnippetDraft {
  id: string;
}
export interface SnippetsApi {
  listSnippets: () => Promise<Snippet[]>;
  saveSnippet: (draft: SnippetDraft, id?: string) => Promise<Snippet>;
  deleteSnippet: (id: string) => Promise<void>;
  onSnippetsChanged: (listener: () => void) => () => void;
}
function label(value: unknown, max: number): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    Array.from(value).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  )
    throw new Error('Snippet names and tags must be non-empty and contain no control characters.');
  return value.trim();
}
export function validateSnippet(value: unknown): SnippetDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid snippet.');
  const draft = value as Record<string, unknown>;
  if (
    Object.keys(draft).some((key) => !['name', 'command', 'folder', 'tags'].includes(key)) ||
    typeof draft.command !== 'string' ||
    !draft.command.trim() ||
    draft.command.length > MAX_SNIPPET_COMMAND ||
    !Array.isArray(draft.tags) ||
    draft.tags.length > 10
  )
    throw new Error(
      'Invalid snippet. Commands must contain 1–4096 characters and at most 10 tags.',
    );
  const command = draft.command.replace(/\r\n?/g, '\n');
  if (
    Array.from(command).some((c) => {
      const code = c.charCodeAt(0);
      return (
        (code < 32 && code !== 9 && code !== 10) ||
        (code >= 127 && code <= 159) ||
        code === 0x2028 ||
        code === 0x2029
      );
    })
  )
    throw new Error('Snippet commands cannot contain terminal control sequences.');
  return {
    name: label(draft.name, 80),
    command,
    folder: validateGroupPath(draft.folder, true),
    tags: [...new Set(Array.from(draft.tags).map((tag) => label(tag, 32)))],
  };
}
export function validateSavedSnippet(value: unknown): Snippet {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid saved snippet.');
  const { id, ...draft } = value as Record<string, unknown>;
  if (!validHostId(id)) throw new Error('Invalid snippet ID.');
  return { ...validateSnippet(draft), id };
}
export function matchingSnippets(entries: Snippet[], query: string, folder: string): Snippet[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return entries
    .filter(
      (entry) =>
        (!folder || entry.folder === folder || entry.folder.startsWith(folder + '/')) &&
        words.every((word) =>
          [entry.name, entry.command, entry.folder, ...entry.tags]
            .join('\n')
            .toLowerCase()
            .includes(word),
        ),
    )
    .sort(
      (a, b) =>
        a.folder.localeCompare(b.folder) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    );
}
