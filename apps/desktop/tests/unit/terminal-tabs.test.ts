import { describe, expect, it } from 'vitest';
import {
  tabsReducer,
  tabTitle,
  type TabsState,
} from '../../src/renderer/src/features/workspace/tabs.js';
import { MAX_TERMINAL_TABS } from '../../src/shared/terminal.js';

function fixture(): TabsState {
  let state: TabsState = { tabs: [], activeId: null };
  for (const id of ['one', 'two', 'three'])
    state = tabsReducer(state, { type: 'add', id, title: id });
  return state;
}

describe('terminal tab state', () => {
  it('creates, selects, renames and reorders without replacing tab identity or lifecycle', () => {
    let state = fixture();
    state = tabsReducer(state, { type: 'phase', id: 'one', phase: 'running' });
    state = tabsReducer(state, { type: 'select', id: 'one' });
    state = tabsReducer(state, { type: 'rename', id: 'one', title: '  Production shell  ' });
    state = tabsReducer(state, { type: 'move', id: 'one', to: 2 });
    expect(state.tabs.map((tab) => tab.id)).toEqual(['two', 'three', 'one']);
    expect(state.activeId).toBe('one');
    expect(state.tabs[2]).toEqual({ id: 'one', title: 'Production shell', phase: 'running' });
  });
  it('chooses a neighboring tab on close and keeps the active tab when closing another', () => {
    let state = fixture();
    state = tabsReducer(state, { type: 'close', id: 'one' });
    expect(state.activeId).toBe('three');
    state = tabsReducer(state, { type: 'close', id: 'three' });
    expect(state.activeId).toBe('two');
    state = tabsReducer(state, { type: 'close', id: 'two' });
    expect(state).toEqual({ tabs: [], activeId: null });
  });
  it('rejects invalid names, unknown IDs, duplicate IDs, moves outside the list, and excess tabs', () => {
    const state = fixture();
    expect(tabTitle('  ')).toBeUndefined();
    expect(tabTitle('line\nbreak')).toBeUndefined();
    expect(tabTitle('x'.repeat(65))).toBeUndefined();
    expect(tabsReducer(state, { type: 'rename', id: 'one', title: '' })).toBe(state);
    expect(tabsReducer(state, { type: 'move', id: 'one', to: -1 })).toBe(state);
    expect(tabsReducer(state, { type: 'close', id: 'missing' })).toBe(state);
    expect(tabsReducer(state, { type: 'phase', id: 'missing', phase: 'running' })).toBe(state);
    expect(tabsReducer(state, { type: 'add', id: 'one', title: 'Duplicate' })).toBe(state);
    let full: TabsState = { tabs: [], activeId: null };
    for (let n = 0; n < MAX_TERMINAL_TABS; n++)
      full = tabsReducer(full, { type: 'add', id: String(n), title: `Terminal ${n}` });
    expect(tabsReducer(full, { type: 'add', id: 'extra', title: 'Extra' })).toBe(full);
  });
});
