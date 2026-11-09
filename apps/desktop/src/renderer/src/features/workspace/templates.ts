import {
  validateWorkspaceTemplate,
  type WorkspaceTemplateDraft,
  type WorkspaceLayout,
} from '../../../../shared/workspace-templates.js';
import type { TabsState } from './tabs.js';
export function captureTemplate(state: TabsState, name: string): WorkspaceTemplateDraft {
  return validateWorkspaceTemplate({
    version: 1,
    name,
    panes: state.tabs.map(({ id, title, hostId }) => ({
      id,
      title,
      ...(hostId ? { hostId } : {}),
    })),
    layouts: state.layouts,
    activeId: state.activeId,
  });
}
export function instantiateTemplate(value: WorkspaceTemplateDraft): TabsState {
  const template = validateWorkspaceTemplate({
    version: value.version,
    name: value.name,
    panes: value.panes,
    layouts: value.layouts,
    activeId: value.activeId,
  });
  const ids = new Map(template.panes.map((pane) => [pane.id, crypto.randomUUID()]));
  function layout(node: WorkspaceLayout): WorkspaceLayout {
    return 'id' in node
      ? { id: ids.get(node.id)! }
      : {
          ...node,
          splitId: crypto.randomUUID(),
          first: layout(node.first),
          second: layout(node.second),
        };
  }
  return {
    tabs: template.panes.map((pane) => ({
      ...pane,
      id: ids.get(pane.id)!,
      phase: 'idle',
      autoStart: false,
    })),
    layouts: template.layouts.map(layout),
    activeId: ids.get(template.activeId)!,
  };
}
