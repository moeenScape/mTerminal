import { MAX_TERMINAL_TABS, type SshConnectionState } from '../../../../shared/terminal.js';
export type TabPhase =
  | 'idle'
  | 'starting'
  | 'running'
  | 'exited'
  | 'error'
  | SshConnectionState
  | 'disconnected'
  | 'failed';
export const tabPhaseLabels: Record<TabPhase, string> = {
  idle: 'Ready',
  starting: 'Starting',
  running: 'Running',
  exited: 'Exited',
  error: 'Error',
  connecting: 'Connecting',
  verifying: 'Verifying key',
  authenticating: 'Authenticating',
  'opening-shell': 'Opening shell',
  connected: 'Connected',
  disconnected: 'Disconnected',
  failed: 'Failed',
};
export function isLiveTab(phase: TabPhase): boolean {
  return [
    'starting',
    'running',
    'connecting',
    'verifying',
    'authenticating',
    'opening-shell',
    'connected',
  ].includes(phase);
}
export interface TerminalTab {
  id: string;
  title: string;
  phase: TabPhase;
  hostId?: string;
}
export type SplitDirection = 'right' | 'down';
export type PaneLayout =
  { id: string } | { direction: SplitDirection; first: PaneLayout; second: PaneLayout };
export interface PanePosition {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
}
export function panePositions(
  layout: PaneLayout,
  bounds = { left: 0, top: 0, width: 100, height: 100 },
): PanePosition[] {
  if ('id' in layout) return [{ id: layout.id, ...bounds }];
  const dimension = layout.direction === 'right' ? 'width' : 'height';
  const offset = layout.direction === 'right' ? 'left' : 'top';
  const half = { ...bounds, [dimension]: bounds[dimension] / 2 };
  return [
    ...panePositions(layout.first, half),
    ...panePositions(layout.second, { ...half, [offset]: bounds[offset] + half[dimension] }),
  ];
}
function splitPane(
  layout: PaneLayout,
  id: string,
  newId: string,
  direction: SplitDirection,
): PaneLayout {
  if ('id' in layout)
    return layout.id === id ? { direction, first: layout, second: { id: newId } } : layout;
  return {
    ...layout,
    first: splitPane(layout.first, id, newId, direction),
    second: splitPane(layout.second, id, newId, direction),
  };
}
function removePane(layout: PaneLayout, id: string): PaneLayout | null {
  if ('id' in layout) return layout.id === id ? null : layout;
  const first = removePane(layout.first, id);
  const second = removePane(layout.second, id);
  return first && second ? { ...layout, first, second } : (first ?? second);
}
export interface TabsState {
  tabs: TerminalTab[];
  layouts: PaneLayout[];
  activeId: string | null;
}
export type TabsAction =
  | { type: 'add'; id: string; title: string; hostId?: string }
  | { type: 'split'; id: string; sourceId: string; title: string; direction: SplitDirection }
  | { type: 'select'; id: string }
  | { type: 'close'; id: string }
  | { type: 'rename'; id: string; title: string }
  | { type: 'move'; id: string; to: number }
  | { type: 'phase'; id: string; phase: TabPhase };
export function tabTitle(value: string): string | undefined {
  const title = value.trim();
  return title &&
    title.length <= 64 &&
    Array.from(title).every(
      (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
    )
    ? title
    : undefined;
}
export function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  const index = state.tabs.findIndex((tab) => tab.id === action.id);
  if (action.type === 'add' || action.type === 'split') {
    const title = tabTitle(action.title);
    if (index >= 0 || !title || state.tabs.length >= MAX_TERMINAL_TABS) return state;
    const source =
      action.type === 'split' ? state.tabs.find((tab) => tab.id === action.sourceId) : undefined;
    if (action.type === 'split' && !source) return state;
    const hostId = action.type === 'split' ? source?.hostId : action.hostId;
    return {
      tabs: [
        ...state.tabs,
        {
          id: action.id,
          title,
          phase: 'idle',
          ...(hostId ? { hostId } : {}),
        },
      ],
      layouts:
        action.type === 'split'
          ? state.layouts.map((layout) =>
              splitPane(layout, action.sourceId, action.id, action.direction),
            )
          : [...state.layouts, { id: action.id }],
      activeId: action.id,
    };
  }
  if (index < 0) return state;
  if (action.type === 'select') return { ...state, activeId: action.id };
  if (action.type === 'close') {
    const tabs = state.tabs.filter((tab) => tab.id !== action.id);
    const group = state.layouts.find((layout) =>
      panePositions(layout).some((pane) => pane.id === action.id),
    );
    const siblings = group ? panePositions(group).filter((pane) => pane.id !== action.id) : [];
    return {
      tabs,
      layouts: state.layouts.flatMap((layout) => {
        const remaining = removePane(layout, action.id);
        return remaining ? [remaining] : [];
      }),
      activeId:
        state.activeId === action.id
          ? (siblings[0]?.id ?? tabs[Math.min(index, tabs.length - 1)]?.id ?? null)
          : state.activeId,
    };
  }
  if (action.type === 'move') {
    if (
      !Number.isInteger(action.to) ||
      action.to < 0 ||
      action.to >= state.tabs.length ||
      action.to === index
    )
      return state;
    const tabs = [...state.tabs];
    const [tab] = tabs.splice(index, 1);
    tabs.splice(action.to, 0, tab!);
    return { ...state, tabs };
  }
  if (action.type === 'rename') {
    const title = tabTitle(action.title);
    if (!title) return state;
    return {
      ...state,
      tabs: state.tabs.map((tab) => (tab.id === action.id ? { ...tab, title } : tab)),
    };
  }
  return {
    ...state,
    tabs: state.tabs.map((tab) =>
      tab.id === action.id && tab.phase !== action.phase ? { ...tab, phase: action.phase } : tab,
    ),
  };
}
