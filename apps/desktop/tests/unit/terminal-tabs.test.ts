import { isLiveTab } from '../../src/renderer/src/features/workspace/tabs.js';
import { describe, expect, it } from 'vitest';
import {
  tabsReducer,
  panePositions,
  tabTitle,
  type TabsState,
} from '../../src/renderer/src/features/workspace/tabs.js';
import { MAX_TERMINAL_TABS } from '../../src/shared/terminal.js';

function fixture(): TabsState {
  let state: TabsState = { tabs: [], layouts: [], activeId: null };
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
    expect(state).toEqual({ tabs: [], layouts: [], activeId: null });
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
    let full: TabsState = { tabs: [], layouts: [], activeId: null };
    for (let n = 0; n < MAX_TERMINAL_TABS; n++)
      full = tabsReducer(full, { type: 'add', id: String(n), title: `Terminal ${n}` });
    expect(tabsReducer(full, { type: 'add', id: 'extra', title: 'Extra' })).toBe(full);
  });
});

describe('SSH tab lifecycle', () => {
  it('requires close confirmation during every active SSH phase', () => {
    for (const phase of [
      'connecting',
      'verifying',
      'authenticating',
      'opening-shell',
      'connected',
    ] as const)
      expect(isLiveTab(phase)).toBe(true);
    for (const phase of ['idle', 'failed', 'disconnected', 'exited'] as const)
      expect(isLiveTab(phase)).toBe(false);
  });
});

describe('split terminal layouts', () => {
  it('splits right and down without replacing existing sessions, then collapses closed branches', () => {
    let state = fixture();
    state = tabsReducer(state, { type: 'phase', id: 'one', phase: 'running' });
    const original = state.tabs[0];
    state = tabsReducer(state, {
      type: 'split',
      id: 'right',
      sourceId: 'one',
      title: 'Right',
      direction: 'right',
    });
    state = tabsReducer(state, {
      type: 'split',
      id: 'bottom',
      sourceId: 'right',
      title: 'Bottom',
      direction: 'down',
    });
    expect(state.tabs[0]).toBe(original);
    expect(state.activeId).toBe('bottom');
    expect(panePositions(state.layouts[0]!)).toEqual([
      { id: 'one', left: 0, top: 0, width: 50, height: 100 },
      { id: 'right', left: 50, top: 0, width: 50, height: 50 },
      { id: 'bottom', left: 50, top: 50, width: 50, height: 50 },
    ]);
    const layouts = state.layouts;
    state = tabsReducer(state, { type: 'select', id: 'one' });
    state = tabsReducer(state, { type: 'move', id: 'one', to: 3 });
    expect(state.layouts).toBe(layouts);
    state = tabsReducer(state, { type: 'close', id: 'right' });
    expect(state.activeId).toBe('one');
    expect(panePositions(state.layouts[0]!)).toEqual([
      { id: 'one', left: 0, top: 0, width: 50, height: 100 },
      { id: 'bottom', left: 50, top: 0, width: 50, height: 100 },
    ]);
    state = tabsReducer(state, { type: 'close', id: 'one' });
    expect(state.activeId).toBe('bottom');
    expect(panePositions(state.layouts[0]!)).toEqual([
      { id: 'bottom', left: 0, top: 0, width: 100, height: 100 },
    ]);
    expect(state.tabs.find((tab) => tab.id === 'bottom')?.phase).toBe('idle');
  });
  it('focuses a surviving pane before an unrelated tab, and removes empty layout groups', () => {
    let state = fixture();
    state = tabsReducer(state, {
      type: 'split',
      id: 'right',
      sourceId: 'one',
      title: 'Right',
      direction: 'right',
    });
    state = tabsReducer(state, { type: 'close', id: 'right' });
    expect(state.activeId).toBe('one');
    expect(state.layouts).toEqual([{ id: 'one' }, { id: 'two' }, { id: 'three' }]);
    state = tabsReducer(state, { type: 'close', id: 'one' });
    expect(state.layouts).toEqual([{ id: 'two' }, { id: 'three' }]);
  });
  it('copies only the SSH host reference into a fresh independent session', () => {
    let state = tabsReducer(
      { tabs: [], layouts: [], activeId: null },
      { type: 'add', id: 'ssh', hostId: 'host-id', title: 'Production' },
    );
    state = tabsReducer(state, { type: 'phase', id: 'ssh', phase: 'connected' });
    state = tabsReducer(state, {
      type: 'split',
      id: 'ssh-copy',
      sourceId: 'ssh',
      title: 'Production',
      direction: 'down',
    });
    expect(state.tabs).toEqual([
      { id: 'ssh', hostId: 'host-id', title: 'Production', phase: 'connected' },
      { id: 'ssh-copy', hostId: 'host-id', title: 'Production', phase: 'idle' },
    ]);
  });
  it('refuses unknown sources, duplicate session IDs and splits exceeding the shared session limit', () => {
    const state = fixture();
    expect(
      tabsReducer(state, {
        type: 'split',
        id: 'new',
        sourceId: 'missing',
        title: 'New',
        direction: 'right',
      }),
    ).toBe(state);
    expect(
      tabsReducer(state, {
        type: 'split',
        id: 'two',
        sourceId: 'one',
        title: 'Duplicate',
        direction: 'down',
      }),
    ).toBe(state);
    let full = state;
    for (let n = state.tabs.length; n < MAX_TERMINAL_TABS; n++)
      full = tabsReducer(full, { type: 'add', id: `extra-${n}`, title: 'Extra' });
    expect(
      tabsReducer(full, {
        type: 'split',
        id: 'overflow',
        sourceId: 'one',
        title: 'Overflow',
        direction: 'right',
      }),
    ).toBe(full);
  });
});
