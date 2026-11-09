import type { WorkspaceLayout, SplitDirection } from '../../../../shared/workspace-templates.js';
export type { SplitDirection };
export type PaneLayout = WorkspaceLayout;
export interface PaneBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface PanePosition extends PaneBounds {
  id: string;
}
export interface PaneDivider extends PaneBounds {
  splitId: string;
  direction: SplitDirection;
  ratio: number;
  minimum: number;
  maximum: number;
  paneIds: string[];
}
export const MIN_PANE_WIDTH = 260;
export const MIN_PANE_HEIGHT = 160;
export function paneIds(layout: PaneLayout): string[] {
  return 'id' in layout ? [layout.id] : [...paneIds(layout.first), ...paneIds(layout.second)];
}
export function minimumPaneSize(layout: PaneLayout): { width: number; height: number } {
  if ('id' in layout) return { width: MIN_PANE_WIDTH, height: MIN_PANE_HEIGHT };
  const first = minimumPaneSize(layout.first);
  const second = minimumPaneSize(layout.second);
  return layout.direction === 'right'
    ? { width: first.width + second.width, height: Math.max(first.height, second.height) }
    : { width: Math.max(first.width, second.width), height: first.height + second.height };
}
export function layoutGeometry(layout: PaneLayout, width: number, height: number) {
  const minimum = minimumPaneSize(layout);
  width = Math.max(width, minimum.width);
  height = Math.max(height, minimum.height);
  const panes: PanePosition[] = [];
  const dividers: PaneDivider[] = [];
  function visit(node: PaneLayout, bounds: PaneBounds) {
    if ('id' in node) {
      panes.push({ id: node.id, ...bounds });
      return;
    }
    const dimension = node.direction === 'right' ? 'width' : 'height';
    const offset = node.direction === 'right' ? 'left' : 'top';
    const minimum = minimumPaneSize(node.first)[dimension] / bounds[dimension];
    const maximum = 1 - minimumPaneSize(node.second)[dimension] / bounds[dimension];
    const ratio = Math.max(minimum, Math.min(maximum, node.ratio));
    dividers.push({
      ...bounds,
      splitId: node.splitId,
      direction: node.direction,
      ratio,
      minimum,
      maximum,
      paneIds: paneIds(node),
    });
    visit(node.first, { ...bounds, [dimension]: bounds[dimension] * ratio });
    visit(node.second, {
      ...bounds,
      [offset]: bounds[offset] + bounds[dimension] * ratio,
      [dimension]: bounds[dimension] - bounds[dimension] * ratio,
    });
  }
  visit(layout, { left: 0, top: 0, width, height });
  return { panes, dividers, width, height };
}
export function splitPane(
  layout: PaneLayout,
  id: string,
  newId: string,
  direction: SplitDirection,
): PaneLayout {
  if ('id' in layout)
    return layout.id === id
      ? { splitId: newId, direction, ratio: 0.5, first: layout, second: { id: newId } }
      : layout;
  return {
    ...layout,
    first: splitPane(layout.first, id, newId, direction),
    second: splitPane(layout.second, id, newId, direction),
  };
}
export function removePane(layout: PaneLayout, id: string): PaneLayout | null {
  if ('id' in layout) return layout.id === id ? null : layout;
  const first = removePane(layout.first, id);
  const second = removePane(layout.second, id);
  return first && second ? { ...layout, first, second } : (first ?? second);
}
export function resizePane(layout: PaneLayout, splitId: string, ratio: number): PaneLayout {
  if ('id' in layout || !Number.isFinite(ratio)) return layout;
  if (layout.splitId === splitId) return { ...layout, ratio: Math.max(0, Math.min(1, ratio)) };
  return {
    ...layout,
    first: resizePane(layout.first, splitId, ratio),
    second: resizePane(layout.second, splitId, ratio),
  };
}
export function adjacentPane(
  panes: PanePosition[],
  id: string,
  direction: string,
): string | undefined {
  const current = panes.find((pane) => pane.id === id);
  if (!current) return;
  const horizontal = direction === 'ArrowLeft' || direction === 'ArrowRight';
  const axis = horizontal ? 'left' : 'top';
  const cross = horizontal ? 'top' : 'left';
  const size = horizontal ? 'width' : 'height';
  const crossSize = horizontal ? 'height' : 'width';
  const forward = direction === 'ArrowRight' || direction === 'ArrowDown';
  return panes
    .filter(
      (pane) =>
        pane.id !== id &&
        (forward
          ? pane[axis] >= current[axis] + current[size] - 0.01
          : pane[axis] + pane[size] <= current[axis] + 0.01),
    )
    .sort((a, b) => {
      const overlap = (pane: PanePosition) =>
        Math.min(pane[cross] + pane[crossSize], current[cross] + current[crossSize]) -
        Math.max(pane[cross], current[cross]);
      const distance = (pane: PanePosition) =>
        Math.abs(pane[axis] + pane[size] / 2 - current[axis] - current[size] / 2) +
        Math.abs(pane[cross] + pane[crossSize] / 2 - current[cross] - current[crossSize] / 2);
      return Number(overlap(b) > 0) - Number(overlap(a) > 0) || distance(a) - distance(b);
    })[0]?.id;
}
