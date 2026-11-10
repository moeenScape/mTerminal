import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validateWorkspaceTemplate } from '../../src/shared/workspace-templates.js';
import {
  captureTemplate,
  instantiateTemplate,
} from '../../src/renderer/src/features/workspace/templates.js';
import { tabsReducer, type TabsState } from '../../src/renderer/src/features/workspace/tabs.js';
import { paneIds } from '../../src/renderer/src/features/workspace/pane-layout.js';
import { MAX_TERMINAL_TABS } from '../../src/shared/terminal.js';
function fixture(): TabsState {
  const first = randomUUID(),
    second = randomUUID();
  let state = tabsReducer(
    { tabs: [], layouts: [], activeId: null },
    { type: 'add', id: first, title: 'Local' },
  );
  state = tabsReducer(state, { type: 'phase', id: first, phase: 'running' });
  state = tabsReducer(state, {
    type: 'split',
    id: second,
    sourceId: first,
    title: 'Build',
    direction: 'right',
  });
  return tabsReducer(state, { type: 'resize', id: first, splitId: second, ratio: 0.62 });
}
describe('workspace template snapshots', () => {
  it('captures only layout metadata and restores fresh idle session IDs without altering live sessions', () => {
    const live = fixture();
    const original = tabsReducer(live, {
      type: 'phase',
      id: live.tabs[0]!.id,
      phase: 'running',
      sessionId: 'runtime-only-session',
    });
    const template = captureTemplate(original, 'Development');
    expect(template.panes[0]).toEqual({ id: original.tabs[0]!.id, title: 'Local' });
    expect(JSON.stringify(template)).not.toMatch(
      /phase|autoStart|password|command|output|sessionId|runtime-only-session/,
    );
    const restored = instantiateTemplate(template);
    expect(restored.tabs.every((tab) => tab.phase === 'idle' && tab.autoStart === false)).toBe(
      true,
    );
    expect(restored.tabs.map((tab) => tab.title)).toEqual(['Local', 'Build']);
    expect(restored.tabs.some((tab) => original.tabs.some((item) => item.id === tab.id))).toBe(
      false,
    );
    expect(paneIds(restored.layouts[0]!)).toEqual(restored.tabs.map((tab) => tab.id));
    expect(restored.activeId).toBe(restored.tabs[1]!.id);
    expect(restored.layouts[0]).toMatchObject({ ratio: 0.62, direction: 'right' });
    const combined = tabsReducer(original, { type: 'restore', workspace: restored });
    expect(combined.tabs[0]).toBe(original.tabs[0]);
    expect(combined.tabs[0]?.phase).toBe('running');
    expect(combined.tabs).toHaveLength(4);
  });
  it('restores SSH references without adding credentials or implicit connection actions', () => {
    const original = fixture();
    original.tabs[1] = { ...original.tabs[1]!, hostId: randomUUID() };
    const draft = captureTemplate(original, 'SSH');
    const restored = instantiateTemplate(draft);
    expect(restored.tabs[1]).toMatchObject({
      hostId: original.tabs[1]!.hostId,
      autoStart: false,
      phase: 'idle',
    });
    expect(Object.keys(draft.panes[1]!)).toEqual(['id', 'title', 'hostId']);
  });
  it('rejects extra secret/command fields, broken layouts, duplicates, cyclic input and invalid ratios', () => {
    const draft = captureTemplate(fixture(), 'Valid');
    for (const patch of [
      { password: 'secret' },
      { startupCommand: 'dangerous' },
      { version: 2 },
      { name: '' },
      { activeId: randomUUID() },
    ])
      expect(() => validateWorkspaceTemplate({ ...draft, ...patch })).toThrow();
    expect(() =>
      validateWorkspaceTemplate({
        ...draft,
        panes: [{ ...draft.panes[0], password: 'secret' }, draft.panes[1]],
      }),
    ).toThrow();
    expect(() =>
      validateWorkspaceTemplate({ ...draft, panes: [draft.panes[0], draft.panes[0]] }),
    ).toThrow();
    expect(() =>
      validateWorkspaceTemplate({ ...draft, layouts: [{ id: draft.panes[0]!.id }] }),
    ).toThrow();
    for (const ratio of [NaN, Infinity, -0.1, 1.1])
      expect(() =>
        validateWorkspaceTemplate({ ...draft, layouts: [{ ...draft.layouts[0], ratio }] }),
      ).toThrow();
    const sparsePanes = draft.panes.slice();
    delete sparsePanes[0];
    expect(() => validateWorkspaceTemplate({ ...draft, panes: sparsePanes })).toThrow();
    expect(() => validateWorkspaceTemplate({ ...draft, layouts: Array(1) })).toThrow();
    const cycle = { ...draft.layouts[0] } as Record<string, unknown>;
    cycle.first = cycle;
    expect(() => validateWorkspaceTemplate({ ...draft, layouts: [cycle] })).toThrow();
    expect(() =>
      validateWorkspaceTemplate({ ...draft, panes: Array(17).fill(draft.panes[0]) }),
    ).toThrow();
  });
  it('refuses restoration atomically at the shared pane limit and on ID conflicts', () => {
    let state = fixture();
    const incoming = instantiateTemplate(captureTemplate(state, 'Saved'));
    for (let n = state.tabs.length; n < MAX_TERMINAL_TABS - 1; n++)
      state = tabsReducer(state, { type: 'add', id: randomUUID(), title: 'Other' });
    expect(tabsReducer(state, { type: 'restore', workspace: incoming })).toBe(state);
    expect(tabsReducer(state, { type: 'restore', workspace: state })).toBe(state);
  });
});
