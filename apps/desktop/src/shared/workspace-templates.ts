import { validHostId } from './hosts.ts';
import { MAX_TERMINAL_TABS } from './terminal.ts';
export type SplitDirection = 'right' | 'down';
export type WorkspaceLayout =
  | { id: string }
  | {
      splitId: string;
      direction: SplitDirection;
      ratio: number;
      first: WorkspaceLayout;
      second: WorkspaceLayout;
    };
export interface TemplatePane {
  id: string;
  title: string;
  hostId?: string;
}
export interface WorkspaceTemplateDraft {
  version: 1;
  name: string;
  panes: TemplatePane[];
  layouts: WorkspaceLayout[];
  activeId: string;
}
export interface WorkspaceTemplate extends WorkspaceTemplateDraft {
  id: string;
}
export const MAX_WORKSPACE_TEMPLATES = 50;
export const templateChannels = {
  list: 'templates:list',
  save: 'templates:save',
  delete: 'templates:delete',
} as const;
export interface TemplatesApi {
  listWorkspaceTemplates: () => Promise<WorkspaceTemplate[]>;
  saveWorkspaceTemplate: (draft: WorkspaceTemplateDraft) => Promise<WorkspaceTemplate>;
  deleteWorkspaceTemplate: (id: string) => Promise<void>;
}
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new Error('Invalid workspace template.');
  return value as Record<string, unknown>;
}
function title(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 64 ||
    Array.from(value).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    throw new Error(
      'Template names and pane titles require 1–64 characters without control characters.',
    );
  return value.trim();
}
export function validateWorkspaceTemplate(value: unknown): WorkspaceTemplateDraft {
  const draft = record(value, ['version', 'name', 'panes', 'layouts', 'activeId']);
  if (
    draft.version !== 1 ||
    !Array.isArray(draft.panes) ||
    !draft.panes.length ||
    draft.panes.length > MAX_TERMINAL_TABS ||
    !Array.isArray(draft.layouts) ||
    !draft.layouts.length ||
    draft.layouts.length > draft.panes.length
  )
    throw new Error('Invalid workspace template.');
  const ids = new Set<string>();
  const panes = Array.from(draft.panes).map((value) => {
    const pane = record(value, ['id', 'title', 'hostId']);
    if (
      !validHostId(pane.id) ||
      ids.has(pane.id) ||
      (pane.hostId !== undefined && !validHostId(pane.hostId))
    )
      throw new Error('Invalid template pane.');
    ids.add(pane.id);
    return {
      id: pane.id,
      title: title(pane.title),
      ...(pane.hostId ? { hostId: pane.hostId as string } : {}),
    };
  });
  const leaves = new Set<string>();
  const splits = new Set<string>();
  let nodes = 0;
  function layout(value: unknown, depth = 0): WorkspaceLayout {
    if (++nodes > MAX_TERMINAL_TABS * 2 || depth >= MAX_TERMINAL_TABS)
      throw new Error('Template layout is too deep.');
    const node = record(value, ['id', 'splitId', 'direction', 'ratio', 'first', 'second']);
    if ('id' in node) {
      if (
        Object.keys(node).length !== 1 ||
        !validHostId(node.id) ||
        !ids.has(node.id) ||
        leaves.has(node.id)
      )
        throw new Error('Invalid layout pane.');
      leaves.add(node.id);
      return { id: node.id };
    }
    if (
      Object.keys(node).length !== 5 ||
      !validHostId(node.splitId) ||
      splits.has(node.splitId) ||
      (node.direction !== 'right' && node.direction !== 'down') ||
      typeof node.ratio !== 'number' ||
      !Number.isFinite(node.ratio) ||
      node.ratio < 0 ||
      node.ratio > 1
    )
      throw new Error('Invalid layout split.');
    splits.add(node.splitId);
    return {
      splitId: node.splitId,
      direction: node.direction,
      ratio: node.ratio,
      first: layout(node.first, depth + 1),
      second: layout(node.second, depth + 1),
    };
  }
  const layouts = Array.from(draft.layouts).map((value) => layout(value));
  if (leaves.size !== ids.size || typeof draft.activeId !== 'string' || !ids.has(draft.activeId))
    throw new Error('Template layout is incomplete.');
  return { version: 1, name: title(draft.name), panes, layouts, activeId: draft.activeId };
}
