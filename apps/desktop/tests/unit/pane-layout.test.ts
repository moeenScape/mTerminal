import { describe, expect, it } from 'vitest';
import {
  layoutGeometry,
  minimumPaneSize,
  resizePane,
  splitPane,
  adjacentPane,
  type PaneLayout,
} from '../../src/renderer/src/features/workspace/pane-layout.js';
import { tabsReducer } from '../../src/renderer/src/features/workspace/tabs.js';
function fixture(): PaneLayout {
  return splitPane(splitPane({ id: 'left' }, 'left', 'upper', 'right'), 'upper', 'lower', 'down');
}
describe('resizable pane geometry', () => {
  it('resizes nested branches independently while preserving pane IDs and covering the canvas', () => {
    let layout = fixture();
    layout = resizePane(layout, 'upper', 0.7);
    layout = resizePane(layout, 'lower', 0.6);
    const geometry = layoutGeometry(layout, 1000, 800);
    expect(geometry.panes).toEqual([
      { id: 'left', left: 0, top: 0, width: 700, height: 800 },
      { id: 'upper', left: 700, top: 0, width: 300, height: 480 },
      { id: 'lower', left: 700, top: 480, width: 300, height: 320 },
    ]);
    expect(geometry.panes.reduce((sum, pane) => sum + pane.width * pane.height, 0)).toBe(800000);
    expect(geometry.dividers.map((divider) => divider.ratio)).toEqual([0.7, 0.6]);
  });
  it('enforces recursive minimums without changing stored ratios when the viewport shrinks', () => {
    const layout = resizePane(fixture(), 'upper', 0.7);
    expect(minimumPaneSize(layout)).toEqual({ width: 520, height: 320 });
    const small = layoutGeometry(layout, 400, 200);
    expect(small.width).toBe(520);
    expect(small.height).toBe(320);
    for (const pane of small.panes) {
      expect(pane.width).toBeGreaterThanOrEqual(260);
      expect(pane.height).toBeGreaterThanOrEqual(160);
    }
    expect(layoutGeometry(layout, 1000, 800).panes[0]?.width).toBe(700);
    expect(layoutGeometry(resizePane(layout, 'lower', 1), 1000, 800).panes[2]?.height).toBeCloseTo(
      160,
    );
    expect(resizePane(layout, 'upper', NaN)).toBe(layout);
  });
  it('selects spatial neighbors only inside the current layout, without wrapping at an edge', () => {
    const { panes } = layoutGeometry(fixture(), 1000, 800);
    expect(adjacentPane(panes, 'left', 'ArrowRight')).toBe('upper');
    expect(adjacentPane(panes, 'upper', 'ArrowDown')).toBe('lower');
    expect(adjacentPane(panes, 'lower', 'ArrowLeft')).toBe('left');
    expect(adjacentPane(panes, 'upper', 'ArrowUp')).toBeUndefined();
    expect(adjacentPane(panes, 'missing', 'ArrowDown')).toBeUndefined();
  });
  it('changes only the owning layout, retaining session objects and focused pane', () => {
    let state = tabsReducer(
      { tabs: [], layouts: [], activeId: null },
      { type: 'add', id: 'left', title: 'Left' },
    );
    state = tabsReducer(state, {
      type: 'split',
      sourceId: 'left',
      id: 'right',
      direction: 'right',
      title: 'Right',
    });
    state = tabsReducer(state, { type: 'add', id: 'other', title: 'Other' });
    const resized = tabsReducer(state, {
      type: 'resize',
      id: 'right',
      splitId: 'right',
      ratio: 0.6,
    });
    expect(resized.tabs).toBe(state.tabs);
    expect(resized.activeId).toBe('other');
    expect(layoutGeometry(resized.layouts[0]!, 1000, 800).panes[0]?.width).toBe(600);
    const wrongGroup = tabsReducer(state, {
      type: 'resize',
      id: 'other',
      splitId: 'right',
      ratio: 0.6,
    });
    expect(wrongGroup.layouts).toEqual(state.layouts);
    expect(
      tabsReducer(state, { type: 'resize', id: 'right', splitId: 'right', ratio: Infinity }),
    ).toBe(state);
  });
});
