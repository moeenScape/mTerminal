import { SessionLogs } from './SessionLogs';
import { BroadcastControls } from './BroadcastControls';
import { BatchCommands } from './BatchCommands';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../components/Icon';
import { ContextMenu, menuPositionFor, type MenuPosition } from '../../components/ContextMenu';
import { MAX_TERMINAL_TABS } from '../../../../shared/terminal';
import { TerminalPane } from './TerminalPane';
import { PaneDivider } from './PaneDivider';
import { WorkspaceTemplates } from './WorkspaceTemplates';
import { instantiateTemplate } from './templates';
import type { WorkspaceTemplateDraft } from '../../../../shared/workspace-templates';
import { paneIds, layoutGeometry, adjacentPane, type SplitDirection } from './pane-layout';
import { paneShortcut } from '../../components/keyboard';
import type { ToolsPreferences } from './TerminalTools';
import {
  tabsReducer,
  tabTitle,
  tabPhaseLabels,
  isLiveTab,
  type TerminalTab,
  type TabPhase,
} from './tabs';

function TabDialog({
  tab,
  mode,
  onCancel,
  onConfirm,
}: {
  tab: TerminalTab;
  mode: 'close' | 'rename';
  onCancel: () => void;
  onConfirm: (title?: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(tab.title);
  const [error, setError] = useState('');
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return (
    <dialog
      className="terminal-dialog"
      ref={dialog}
      aria-labelledby="tab-dialog-heading"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (mode === 'rename') {
            const title = tabTitle(name);
            if (!title) {
              setError('Enter a name of 1–64 characters without control characters.');
              return;
            }
            onConfirm(title);
          } else onConfirm();
        }}
      >
        <h2 id="tab-dialog-heading">
          {mode === 'close' ? `Close “${tab.title}”?` : 'Rename terminal'}
        </h2>
        {mode === 'close' ? (
          <p>
            This stops the session and may interrupt running commands. Its terminal output will be
            discarded.
          </p>
        ) : (
          <label>
            Terminal name
            <input
              autoFocus
              value={name}
              maxLength={64}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </label>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button autoFocus={mode === 'close'} type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit">{mode === 'close' ? 'Close terminal' : 'Save name'}</button>
        </div>
      </form>
    </dialog>
  );
}

export function WorkspaceView({
  active,
  appearance,
  navigationShortcuts,
  onCountChange,
  sshRequest,
  tabBarTarget,
  onActivate,
  onOpenVault,
  toolsPreferences,
  onToolsPreferenceChange,
}: {
  sshRequest: { id: string; hostId?: string; serialId?: string; title: string } | null;
  active: boolean;
  appearance: 'dark' | 'light';
  navigationShortcuts: boolean;
  onCountChange: (count: number) => void;
  /** Element in the app's top bar that hosts the session tab strip. */
  tabBarTarget: HTMLElement | null;
  /** Shows the workspace view, e.g. when a session tab is chosen from another view. */
  onActivate: () => void;
  onOpenVault: () => Promise<void>;
  toolsPreferences: ToolsPreferences;
  onToolsPreferenceChange: (patch: Partial<ToolsPreferences>) => Promise<void>;
}) {
  const [state, dispatch] = useReducer(tabsReducer, { tabs: [], layouts: [], activeId: null });
  const [showTemplates, setShowTemplates] = useState(false);
  const [showBatch, setShowBatch] = useState(false);
  const [showBroadcast, setShowBroadcast] = useState(false);
  const closeBroadcastSetup = useCallback(() => setShowBroadcast(false), []);
  useEffect(() => window.mterminal.onVaultLocked(() => setShowBatch(false)), []);
  const [dialog, setDialog] = useState<{ id: string; mode: 'close' | 'rename' } | null>(null);
  const [tabMenu, setTabMenu] = useState<{ id: string; position: MenuPosition } | null>(null);
  const panels = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const nextNumber = useRef(1);
  const dragged = useRef<string | null>(null);
  const focusFrame = useRef<number | undefined>(undefined);
  const running = state.tabs.filter(
    (tab) => tab.phase === 'running' || tab.phase === 'connected',
  ).length;
  const selectedLayout = state.layouts.find((layout) =>
    paneIds(layout).includes(state.activeId ?? ''),
  );
  const geometry = selectedLayout
    ? layoutGeometry(selectedLayout, viewport.width, viewport.height)
    : null;
  const visiblePanes = geometry?.panes ?? [];
  const hasTabs = state.tabs.length > 0;
  useEffect(() => {
    const element = panels.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      if (width && height)
        setViewport((previous) =>
          previous.width === width && previous.height === height ? previous : { width, height },
        );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasTabs]);
  const dialogTab = state.tabs.find((tab) => tab.id === dialog?.id);
  const menuTab = state.tabs.find((tab) => tab.id === tabMenu?.id);
  const phaseChanged = useCallback(
    (id: string, phase: TabPhase, sessionId?: string) =>
      dispatch({ type: 'phase', id, phase, ...(sessionId ? { sessionId } : {}) }),
    [],
  );
  const handledSsh = useRef<string | null>(null);
  const [limitError, setLimitError] = useState('');
  useEffect(() => {
    if (!sshRequest || handledSsh.current === sshRequest.id) return;
    const frame = requestAnimationFrame(() => {
      handledSsh.current = sshRequest.id;
      if (state.tabs.length >= MAX_TERMINAL_TABS) {
        setLimitError('Close a terminal tab before connecting another host.');
        return;
      }
      setLimitError('');
      dispatch({
        type: 'add',
        id: sshRequest.id,
        title: sshRequest.title,
        ...(sshRequest.hostId ? { hostId: sshRequest.hostId } : {}),
        ...(sshRequest.serialId ? { serialId: sshRequest.serialId } : {}),
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [sshRequest, state.tabs.length]);
  useEffect(() => onCountChange(running), [running, onCountChange]);
  useEffect(
    () => () => {
      if (focusFrame.current !== undefined) cancelAnimationFrame(focusFrame.current);
    },
    [],
  );
  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => {
      if (document.activeElement?.getAttribute('role') === 'tab') return;
      const panelId = document
        .querySelector('[role="tablist"][aria-label="Terminal sessions"] [aria-selected="true"]')
        ?.getAttribute('aria-controls');
      if (panelId)
        document.getElementById(panelId)?.querySelector<HTMLTextAreaElement>('textarea')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [active]);
  function focus(id: string | null, pane = false) {
    if (focusFrame.current !== undefined) cancelAnimationFrame(focusFrame.current);
    focusFrame.current = requestAnimationFrame(() => {
      document
        .getElementById(`terminal-tab-${id}`)
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const element = document.getElementById(`${pane ? 'terminal-panel' : 'terminal-tab'}-${id}`);
      if (element?.clientWidth)
        (pane ? element.querySelector<HTMLTextAreaElement>('textarea') : element)?.focus();
    });
  }
  function paneKeyDown(event: React.KeyboardEvent) {
    const command = paneShortcut(event.nativeEvent);
    if (
      !navigationShortcuts ||
      !command ||
      !active ||
      !state.activeId ||
      !geometry ||
      !(event.target instanceof Element) ||
      !event.target.matches('.xterm-helper-textarea') ||
      document.querySelector('dialog[open], [role="menu"]')
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    if (command === 'focus') {
      const id = adjacentPane(visiblePanes, state.activeId, event.key);
      if (id) {
        dispatch({ type: 'select', id });
        focus(id, true);
      }
    } else {
      const direction = event.key === 'ArrowLeft' || event.key === 'ArrowRight' ? 'right' : 'down';
      const divider = geometry.dividers
        .filter((item) => item.direction === direction && item.paneIds.includes(state.activeId!))
        .sort((a, b) => a.width * a.height - b.width * b.height)[0];
      if (!divider) return;
      const sign = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
      dispatch({
        type: 'resize',
        id: state.activeId,
        splitId: divider.splitId,
        ratio: Math.max(divider.minimum, Math.min(divider.maximum, divider.ratio + sign * 0.02)),
      });
    }
  }
  async function openTemplate(template: WorkspaceTemplateDraft) {
    if (state.tabs.length + template.panes.length > MAX_TERMINAL_TABS)
      throw new Error(
        `Close some sessions first. A workspace supports at most ${MAX_TERMINAL_TABS} panes.`,
      );
    const hosts = await window.mterminal.listHosts();
    if (
      template.panes.some((pane) => pane.hostId && !hosts.some((host) => host.id === pane.hostId))
    )
      throw new Error('A saved host is missing. Recreate the template with an existing host.');
    const incoming = instantiateTemplate(template);
    dispatch({ type: 'restore', workspace: incoming });
    setShowTemplates(false);
    onActivate();
    focus(incoming.activeId, true);
  }
  function add() {
    if (state.tabs.length >= MAX_TERMINAL_TABS) return;
    const id = crypto.randomUUID();
    dispatch({ type: 'add', id, title: `Terminal ${nextNumber.current++}` });
    onActivate();
    focus(id, true);
  }
  function split(sourceId: string, direction: SplitDirection) {
    const source = state.tabs.find((tab) => tab.id === sourceId);
    if (!source || state.tabs.length >= MAX_TERMINAL_TABS) return;
    const id = crypto.randomUUID();
    dispatch({
      type: 'split',
      id,
      sourceId,
      direction,
      title: source.hostId ? source.title : `Terminal ${nextNumber.current++}`,
    });
    onActivate();
    focus(id, true);
  }
  function close(id: string) {
    const next = tabsReducer(state, { type: 'close', id });
    dispatch({ type: 'close', id });
    focus(next.activeId, true);
  }
  const requestClose = (id: string) => {
    const tab = state.tabs.find((item) => item.id === id);
    if (tab && isLiveTab(tab.phase)) setDialog({ id, mode: 'close' });
    else close(id);
  };
  function keyDown(event: React.KeyboardEvent, index: number) {
    const tab = state.tabs[index]!;
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      setTabMenu({ id: tab.id, position: menuPositionFor(event.currentTarget) });
      return;
    }
    if (event.key === 'F2') {
      event.preventDefault();
      setDialog({ id: tab.id, mode: 'rename' });
      return;
    }
    if (event.key === 'Delete') {
      event.preventDefault();
      requestClose(tab.id);
      return;
    }
    let to: number;
    if (event.key === 'ArrowRight') to = (index + 1) % state.tabs.length;
    else if (event.key === 'ArrowLeft') to = (index + state.tabs.length - 1) % state.tabs.length;
    else if (event.key === 'Home') to = 0;
    else if (event.key === 'End') to = state.tabs.length - 1;
    else return;
    event.preventDefault();
    if (
      event.altKey &&
      event.shiftKey &&
      (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
    ) {
      const destination = index + (event.key === 'ArrowLeft' ? -1 : 1);
      dispatch({ type: 'move', id: tab.id, to: destination });
      focus(tab.id);
    } else {
      dispatch({ type: 'select', id: state.tabs[to]!.id });
      focus(state.tabs[to]!.id);
    }
  }
  const sessionTabs = (
    <>
      {state.tabs.length > 0 && (
        <div className="terminal-tabs" role="tablist" aria-label="Terminal sessions">
          {state.tabs.map((tab, index) => (
            <div
              key={tab.id}
              className="terminal-tab-item"
              draggable
              onDragStart={(event) => {
                dragged.current = tab.id;
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', tab.id);
              }}
              onDragEnd={() => {
                dragged.current = null;
              }}
              onDragOver={(event) => {
                if (dragged.current) event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragged.current) dispatch({ type: 'move', id: dragged.current, to: index });
                dragged.current = null;
              }}
            >
              <button
                type="button"
                role="tab"
                id={`terminal-tab-${tab.id}`}
                aria-label={tab.title}
                aria-describedby={`terminal-phase-${tab.id}`}
                aria-selected={state.activeId === tab.id}
                aria-controls={`terminal-panel-${tab.id}`}
                tabIndex={state.activeId === tab.id ? 0 : -1}
                title={`${tab.title} — ${tabPhaseLabels[tab.phase]}`}
                onClick={() => {
                  dispatch({ type: 'select', id: tab.id });
                  onActivate();
                  focus(tab.id, true);
                }}
                onKeyDown={(event) => keyDown(event, index)}
                onDoubleClick={() => setDialog({ id: tab.id, mode: 'rename' })}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setTabMenu({ id: tab.id, position: { x: event.clientX, y: event.clientY } });
                }}
              >
                <span
                  className={`terminal-tab-dot terminal-tab-dot--${phaseTone(tab.phase)}`}
                  aria-hidden="true"
                />
                <span className="terminal-tab-title">{tab.title}</span>
                <span id={`terminal-phase-${tab.id}`} className="sr-only">
                  {tabPhaseLabels[tab.phase]}
                </span>
              </button>
              <button
                type="button"
                className="terminal-tab-close"
                tabIndex={state.activeId === tab.id ? 0 : -1}
                aria-label={`Close ${tab.title}`}
                onClick={() => requestClose(tab.id)}
              >
                <Icon name="close" />
              </button>
            </div>
          ))}
        </div>
      )}
      <SessionLogs
        onActivate={onActivate}
        panes={state.tabs
          .filter((tab) => tab.sessionId && (tab.phase === 'running' || tab.phase === 'connected'))
          .map((tab) => ({ sessionId: tab.sessionId!, title: tab.title }))}
      />
      <button
        type="button"
        className="session-new"
        aria-label="Broadcast input"
        title="Select sessions for broadcast input"
        onClick={() => {
          onActivate();
          setShowBroadcast(true);
        }}
      >
        <Icon name="terminal" />
      </button>
      <button
        type="button"
        className="session-new"
        aria-label="Run on hosts"
        title="Review a command for connected SSH hosts"
        onClick={() => {
          onActivate();
          setShowBatch(true);
        }}
      >
        <Icon name="hosts" />
      </button>
      <button
        type="button"
        className="session-new"
        aria-label="Workspace templates"
        title="Save or open a workspace layout"
        onClick={() => {
          onActivate();
          setShowTemplates(true);
        }}
      >
        <Icon name="folder" />
      </button>
      <button
        type="button"
        className="session-new"
        aria-label="New terminal"
        title={`New local terminal (up to ${MAX_TERMINAL_TABS} tabs)`}
        disabled={state.tabs.length >= MAX_TERMINAL_TABS}
        onClick={add}
      >
        <Icon name="plus" />
      </button>
    </>
  );
  return (
    <div className="local-workspace" hidden={!active} onKeyDownCapture={paneKeyDown}>
      {tabBarTarget && createPortal(sessionTabs, tabBarTarget)}
      <h1 className="sr-only">Workspace</h1>
      <BroadcastControls
        active={active}
        setupOpen={showBroadcast}
        onCloseSetup={closeBroadcastSetup}
        paneTitles={Object.fromEntries(
          state.tabs.filter((tab) => tab.sessionId).map((tab) => [tab.sessionId!, tab.title]),
        )}
      />
      {limitError && (
        <p className="workspace-alert" role="alert">
          {limitError}
        </p>
      )}
      {state.tabs.length === 0 ? (
        <div className="terminal-empty">
          <Icon name="terminal" className="empty-state-icon" />
          <h2>No terminal tabs</h2>
          <p>Open a local shell, or connect to a saved host from Hosts.</p>
          <button type="button" className="primary-button" onClick={add}>
            Start local shell
          </button>
        </div>
      ) : (
        <>
          <div className="terminal-panels" ref={panels}>
            <p id="pane-resize-help" className="sr-only">
              Drag to resize. Arrow keys move this divider; Home/End reach its limits, Enter or
              double-click balances panes, Escape cancels a drag.
            </p>
            <div
              className="terminal-layout"
              style={{ width: geometry?.width, height: geometry?.height }}
            >
              {/* Stable siblings preserve sessions and scrollback when the layout changes. */}
              {state.tabs.map((tab) => (
                <TerminalPane
                  key={tab.id}
                  id={tab.id}
                  title={tab.title}
                  hostId={tab.hostId}
                  serialId={tab.serialId}
                  active={active && state.activeId === tab.id}
                  autoStart={tab.autoStart !== false}
                  visible={active && visiblePanes.some((pane) => pane.id === tab.id)}
                  position={visiblePanes.find((pane) => pane.id === tab.id)}
                  split={visiblePanes.length > 1}
                  onActivate={() => {
                    if (state.activeId !== tab.id) dispatch({ type: 'select', id: tab.id });
                  }}
                  onSplit={(direction) => split(tab.id, direction)}
                  canSplit={state.tabs.length < MAX_TERMINAL_TABS}
                  appearance={appearance}
                  navigationShortcuts={navigationShortcuts}
                  onPhaseChange={phaseChanged}
                  onRequestClose={requestClose}
                  onOpenVault={onOpenVault}
                  toolsPreferences={toolsPreferences}
                  onToolsPreferenceChange={onToolsPreferenceChange}
                />
              ))}
              {geometry?.dividers.map((divider, index) => (
                <PaneDivider
                  key={`divider-${divider.splitId}`}
                  divider={divider}
                  index={index}
                  onResize={(ratio) => {
                    if (state.activeId)
                      dispatch({
                        type: 'resize',
                        id: state.activeId,
                        splitId: divider.splitId,
                        ratio,
                      });
                  }}
                />
              ))}
            </div>
          </div>
        </>
      )}
      {showBatch && <BatchCommands onClose={() => setShowBatch(false)} />}
      {showTemplates && (
        <WorkspaceTemplates
          state={state}
          onOpen={openTemplate}
          onClose={() => setShowTemplates(false)}
        />
      )}
      {tabMenu && menuTab && (
        <ContextMenu
          label={`Tab actions for ${menuTab.title}`}
          position={tabMenu.position}
          onClose={() => setTabMenu(null)}
          items={[
            {
              label: 'Rename…',
              shortcut: 'F2',
              onSelect: () => setDialog({ id: menuTab.id, mode: 'rename' }),
            },
            {
              label: 'Split right',
              disabled: state.tabs.length >= MAX_TERMINAL_TABS,
              onSelect: () => split(menuTab.id, 'right'),
            },
            {
              label: 'Split down',
              disabled: state.tabs.length >= MAX_TERMINAL_TABS,
              onSelect: () => split(menuTab.id, 'down'),
            },
            {
              label: 'Move left',
              disabled: state.tabs[0]?.id === menuTab.id,
              onSelect: () =>
                dispatch({ type: 'move', id: menuTab.id, to: state.tabs.indexOf(menuTab) - 1 }),
            },
            {
              label: 'Move right',
              disabled: state.tabs.at(-1)?.id === menuTab.id,
              onSelect: () =>
                dispatch({ type: 'move', id: menuTab.id, to: state.tabs.indexOf(menuTab) + 1 }),
            },
            {
              label: 'Close',
              danger: true,
              separator: true,
              onSelect: () => requestClose(menuTab.id),
            },
          ]}
        />
      )}
      {dialog && dialogTab && (
        <TabDialog
          key={`${dialog.id}-${dialog.mode}`}
          tab={dialogTab}
          mode={dialog.mode}
          onCancel={() => setDialog(null)}
          onConfirm={(title) => {
            if (dialog.mode === 'close') close(dialog.id);
            else {
              dispatch({ type: 'rename', id: dialog.id, title: title! });
              focus(dialog.id);
            }
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}

function phaseTone(phase: TabPhase): 'live' | 'pending' | 'error' | 'idle' {
  if (phase === 'running' || phase === 'connected') return 'live';
  if (phase === 'error' || phase === 'failed') return 'error';
  if (isLiveTab(phase)) return 'pending';
  return 'idle';
}
