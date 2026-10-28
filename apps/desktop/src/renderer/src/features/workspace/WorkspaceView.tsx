import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { MAX_TERMINAL_TABS } from '../../../../shared/terminal';
import { TerminalPane } from './TerminalPane';
import { tabsReducer, tabTitle, type TerminalTab, type TabPhase } from './tabs';

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
}: {
  active: boolean;
  appearance: 'dark' | 'light';
  navigationShortcuts: boolean;
  onCountChange: (count: number) => void;
}) {
  const [state, dispatch] = useReducer(tabsReducer, { tabs: [], activeId: null });
  const [dialog, setDialog] = useState<{ id: string; mode: 'close' | 'rename' } | null>(null);
  const workspace = useRef<HTMLDivElement>(null);
  const nextNumber = useRef(1);
  const dragged = useRef<string | null>(null);
  const focusFrame = useRef<number | undefined>(undefined);
  const current = state.tabs.find((tab) => tab.id === state.activeId);
  const running = state.tabs.filter((tab) => tab.phase === 'running').length;
  const dialogTab = state.tabs.find((tab) => tab.id === dialog?.id);
  const phaseChanged = useCallback(
    (id: string, phase: TabPhase) => dispatch({ type: 'phase', id, phase }),
    [],
  );
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
      const panelId = workspace.current
        ?.querySelector('[role="tab"][aria-selected="true"]')
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
  function add() {
    if (state.tabs.length >= MAX_TERMINAL_TABS) return;
    const id = crypto.randomUUID();
    dispatch({ type: 'add', id, title: `Terminal ${nextNumber.current++}` });
    focus(id, true);
  }
  function close(id: string) {
    const next = tabsReducer(state, { type: 'close', id });
    dispatch({ type: 'close', id });
    focus(next.activeId);
  }
  const requestClose = (id: string) => {
    const tab = state.tabs.find((item) => item.id === id);
    if (tab?.phase === 'running' || tab?.phase === 'starting') setDialog({ id, mode: 'close' });
    else close(id);
  };
  function keyDown(event: React.KeyboardEvent, index: number) {
    const tab = state.tabs[index]!;
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
  return (
    <div className="local-workspace" ref={workspace} hidden={!active}>
      <header className="terminal-toolbar">
        <div>
          <h1>Workspace</h1>
          <span>
            {state.tabs.length} tabs · {running} running
          </span>
        </div>
        <button
          type="button"
          className="secondary-button"
          disabled={state.tabs.length >= MAX_TERMINAL_TABS}
          title={`Up to ${MAX_TERMINAL_TABS} terminal tabs`}
          onClick={add}
        >
          New terminal
        </button>
      </header>
      {state.tabs.length === 0 ? (
        <div className="terminal-empty">
          <h2>No terminal tabs</h2>
          <p>Open a local shell to start working.</p>
          <button type="button" className="secondary-button" onClick={add}>
            Start local shell
          </button>
        </div>
      ) : (
        <>
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
                  onClick={() => {
                    dispatch({ type: 'select', id: tab.id });
                    focus(tab.id, true);
                  }}
                  onKeyDown={(event) => keyDown(event, index)}
                  onDoubleClick={() => setDialog({ id: tab.id, mode: 'rename' })}
                >
                  <span className="terminal-tab-title" title={tab.title}>
                    {tab.title}
                  </span>
                  <span id={`terminal-phase-${tab.id}`} className="terminal-tab-phase">
                    {
                      {
                        idle: 'Ready',
                        starting: 'Starting',
                        running: 'Running',
                        exited: 'Exited',
                        error: 'Error',
                      }[tab.phase]
                    }
                  </span>
                </button>
                <button
                  type="button"
                  className="terminal-tab-close"
                  tabIndex={state.activeId === tab.id ? 0 : -1}
                  aria-label={`Close ${tab.title}`}
                  onClick={() => requestClose(tab.id)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="terminal-tab-actions">
            <button
              type="button"
              onClick={() => current && setDialog({ id: current.id, mode: 'rename' })}
            >
              Rename
            </button>
            <button
              type="button"
              disabled={state.tabs[0]?.id === state.activeId}
              onClick={() =>
                current &&
                dispatch({ type: 'move', id: current.id, to: state.tabs.indexOf(current) - 1 })
              }
            >
              Move left
            </button>
            <button
              type="button"
              disabled={state.tabs.at(-1)?.id === state.activeId}
              onClick={() =>
                current &&
                dispatch({ type: 'move', id: current.id, to: state.tabs.indexOf(current) + 1 })
              }
            >
              Move right
            </button>
          </div>
          <div className="terminal-panels">
            {state.tabs.map((tab) => (
              <TerminalPane
                key={tab.id}
                id={tab.id}
                active={active && state.activeId === tab.id}
                appearance={appearance}
                navigationShortcuts={navigationShortcuts}
                onPhaseChange={phaseChanged}
                onRequestClose={requestClose}
              />
            ))}
          </div>
        </>
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
