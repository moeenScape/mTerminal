import {
  paneIds,
  splitPane,
  removePane,
  resizePane,
  type PaneLayout,
  type SplitDirection,
} from './pane-layout.js';
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
  proxying: 'Via proxy',
  jumping: 'Via jump host',
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
    'proxying',
    'jumping',
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
  /** Serial profile opened by this tab; never copied to splits or templates. */
  serialId?: string;
  sessionId?: string;
  autoStart?: false;
}
export interface TabsState {
  tabs: TerminalTab[];
  layouts: PaneLayout[];
  activeId: string | null;
}
export type TabsAction =
  | { type: 'restore'; workspace: TabsState }
  | { type: 'add'; id: string; title: string; hostId?: string; serialId?: string }
  | { type: 'split'; id: string; sourceId: string; title: string; direction: SplitDirection }
  | { type: 'resize'; id: string; splitId: string; ratio: number }
  | { type: 'select'; id: string }
  | { type: 'close'; id: string }
  | { type: 'rename'; id: string; title: string }
  | { type: 'move'; id: string; to: number }
  | { type: 'phase'; id: string; phase: TabPhase; sessionId?: string };
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
  if (action.type === 'restore') {
    const incoming = action.workspace;
    const ids = new Set(incoming.tabs.map((tab) => tab.id));
    if (
      !incoming.tabs.length ||
      state.tabs.length + incoming.tabs.length > MAX_TERMINAL_TABS ||
      ids.size !== incoming.tabs.length ||
      state.tabs.some((tab) => ids.has(tab.id))
    )
      return state;
    return {
      tabs: [...state.tabs, ...incoming.tabs],
      layouts: [...state.layouts, ...incoming.layouts],
      activeId: incoming.activeId,
    };
  }
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
          ...(action.type === 'add' && action.serialId && !hostId
            ? { serialId: action.serialId }
            : {}),
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
  if (action.type === 'resize') {
    if (!Number.isFinite(action.ratio)) return state;
    return {
      ...state,
      layouts: state.layouts.map((layout) =>
        paneIds(layout).includes(action.id)
          ? resizePane(layout, action.splitId, action.ratio)
          : layout,
      ),
    };
  }
  if (action.type === 'select') return { ...state, activeId: action.id };
  if (action.type === 'close') {
    const tabs = state.tabs.filter((tab) => tab.id !== action.id);
    const group = state.layouts.find((layout) => paneIds(layout).includes(action.id));
    const siblings = group ? paneIds(group).filter((id) => id !== action.id) : [];
    return {
      tabs,
      layouts: state.layouts.flatMap((layout) => {
        const remaining = removePane(layout, action.id);
        return remaining ? [remaining] : [];
      }),
      activeId:
        state.activeId === action.id
          ? (siblings[0] ?? tabs[Math.min(index, tabs.length - 1)]?.id ?? null)
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
    tabs: state.tabs.map((tab) => {
      if (tab.id !== action.id) return tab;
      const next = { ...tab, phase: action.phase };
      if (action.sessionId) next.sessionId = action.sessionId;
      else if (!isLiveTab(action.phase)) delete next.sessionId;
      return next;
    }),
  };
}
