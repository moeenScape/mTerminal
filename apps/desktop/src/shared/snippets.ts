import { validHostId, validateGroupPath } from './hosts.js';
export const MAX_SNIPPETS = 200;
export const MAX_SNIPPET_COMMAND = 4096;
export const snippetChannels = {
  list: 'snippets:list',
  save: 'snippets:save',
  delete: 'snippets:delete',
  startup: 'snippets:startup',
  setStartup: 'snippets:set-startup',
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
  getStartupSnippet: (target: string) => Promise<Snippet | null>;
  setStartupSnippet: (target: string, snippetId: string | null) => Promise<void>;
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

export const MAX_STARTUP_ASSIGNMENTS = 500;
export interface StartupAssignment {
  target: string;
  snippetId: string;
}
export interface SnippetCatalog {
  version: 1;
  snippets: Snippet[];
  startup: StartupAssignment[];
}
export function validStartupTarget(value: unknown): value is string {
  return value === 'local' || validHostId(value);
}
/** Version 1 files written before startup assignments omit `startup`. */
export function validateSnippetCatalog(value: unknown): SnippetCatalog {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid snippet catalog.');
  const data = value as Record<string, unknown>;
  if (
    Object.keys(data).some((key) => !['version', 'snippets', 'startup'].includes(key)) ||
    data.version !== 1 ||
    !Array.isArray(data.snippets) ||
    data.snippets.length > MAX_SNIPPETS ||
    (data.startup !== undefined &&
      (!Array.isArray(data.startup) || data.startup.length > MAX_STARTUP_ASSIGNMENTS))
  )
    throw new Error('Invalid snippet catalog.');
  const snippets = Array.from(data.snippets).map(validateSavedSnippet);
  const ids = new Set(snippets.map((snippet) => snippet.id));
  if (ids.size !== snippets.length) throw new Error('Duplicate snippet IDs.');
  const targets = new Set<string>();
  const startup = Array.from((data.startup ?? []) as unknown[]).map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Invalid startup assignment.');
    const item = value as Record<string, unknown>;
    if (
      Object.keys(item).length !== 2 ||
      Object.keys(item).some((key) => !['target', 'snippetId'].includes(key)) ||
      !validStartupTarget(item.target) ||
      targets.has(item.target) ||
      typeof item.snippetId !== 'string' ||
      !ids.has(item.snippetId)
    )
      throw new Error('Invalid startup assignment.');
    targets.add(item.target);
    return { target: item.target, snippetId: item.snippetId };
  });
  return { version: 1, snippets, startup };
}
