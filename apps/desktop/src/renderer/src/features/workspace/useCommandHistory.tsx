import { useCallback, useEffect, useRef, useState, useId, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../components/Icon';
import { autocompleteMatches, autocompletePosition } from './autocomplete';
import type { Terminal, IMarker } from '@xterm/xterm';
import type { CommandHistoryEntry } from '../../../../shared/history';

export function useCommandHistory(
  active: boolean,
  local: boolean,
  session: RefObject<string | null>,
  ready: RefObject<boolean>,
  container: RefObject<HTMLDivElement | null>,
) {
  const toolId = useId();
  const terminal = useRef<Terminal | null>(null);
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<CommandHistoryEntry[]>([]);
  const [message, setMessage] = useState('');
  const [revision, setRevision] = useState(0);
  const [integration, setIntegration] = useState<
    'unknown' | 'disabled' | 'unsupported' | 'starting' | 'ready'
  >('unknown');
  const onSessionStatus = useCallback(
    (status: 'disabled' | 'unsupported' | 'starting') => setIntegration(status),
    [],
  );
  const [tool, setTool] = useState<'history' | 'autocomplete'>('history');
  const [autocomplete, setAutocomplete] = useState(true);
  const autocompleteRef = useRef(true);
  const [selected, setSelected] = useState(0);
  const [popup, setPopup] = useState<{
    prefix: string;
    items: CommandHistoryEntry[];
    left: number;
    top: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const marker = useRef<IMarker | null>(null);
  const column = useRef(0);
  const directory = useRef('');
  const suggestion = useRef<{ prefix: string; items: CommandHistoryEntry[]; index: number } | null>(
    null,
  );
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const version = useRef(0);
  const lastQuery = useRef('');
  const vaultEpoch = useRef(0);

  const dismiss = useCallback(() => {
    version.current++;
    clearTimeout(timer.current);
    suggestion.current = null;
    setPopup(null);
  }, []);

  const prefix = useCallback((): string | undefined => {
    const term = terminal.current;
    const start = marker.current;
    if (!term || !start || start.isDisposed || !ready.current || term.hasSelection()) return;
    const buffer = term.buffer.active;
    if (buffer.type !== 'normal' || buffer.viewportY !== buffer.baseY) return;
    const end = buffer.baseY + buffer.cursorY;
    if (end < start.line || end - start.line > 8) return;
    if (buffer.getLine(end)?.translateToString(true, buffer.cursorX).trim()) return;
    let text = '';
    for (let row = start.line; row <= end; row++) {
      const line = buffer.getLine(row);
      if (!line || (row > start.line && !line.isWrapped)) return;
      text += line.translateToString(
        false,
        row === start.line ? column.current : 0,
        row === end ? buffer.cursorX : term.cols,
      );
    }
    return text.length <= 4096 ? text : undefined;
  }, [terminal, ready]);

  const attach = useCallback(
    (term: Terminal) => {
      if (!local) return () => {};
      terminal.current = term;
      const render = () => {
        const text = prefix();
        if (!autocompleteRef.current || !text || text.startsWith(' ')) {
          lastQuery.current = '';
          dismiss();
          return;
        }
        const key = `${directory.current}\0${text}`;
        if (lastQuery.current === key) return;
        lastQuery.current = key;
        dismiss();
        const request = version.current;
        timer.current = setTimeout(() => {
          void window.mterminal
            .searchHistory(text, directory.current)
            .then((items) => {
              if (request !== version.current || prefix() !== text) return;
              const matches = autocompleteMatches(items, text);
              const screen = container.current?.querySelector<HTMLElement>('.xterm-screen');
              const host = container.current;
              if (!screen || !host) return;
              const rect = screen.getBoundingClientRect();
              const parent = host.getBoundingClientRect();
              const position = autocompletePosition(
                {
                  left:
                    rect.left - parent.left + (term.buffer.active.cursorX * rect.width) / term.cols,
                  top:
                    rect.top - parent.top + (term.buffer.active.cursorY * rect.height) / term.rows,
                  rowHeight: rect.height / term.rows,
                },
                { width: host.clientWidth, height: host.clientHeight },
                matches.length,
              );
              if (!position) return;
              suggestion.current = { prefix: text, items: matches, index: 0 };
              setSelected(0);
              setPopup({ prefix: text, items: matches, ...position });
            })
            .catch(() => {
              if (request === version.current) dismiss();
            });
        }, 120);
      };
      const osc = term.parser.registerOscHandler(777, (data) => {
        if (!data.startsWith('mterminal;')) return false;
        dismiss();
        marker.current?.dispose();
        marker.current = term.registerMarker(0) ?? null;
        column.current = term.buffer.active.cursorX;
        try {
          directory.current = new TextDecoder().decode(
            Uint8Array.from(atob(data.slice(10)), (c) => c.charCodeAt(0)),
          );
          setIntegration('ready');
        } catch {
          marker.current?.dispose();
          marker.current = null;
        }
        lastQuery.current = '';
        return true;
      });
      const rendered = term.onRender(render);
      const scrolled = term.onScroll(() => {
        lastQuery.current = '';
        dismiss();
      });
      const resized = term.onResize(() => {
        lastQuery.current = '';
        dismiss();
      });
      return () => {
        setIntegration('unknown');
        terminal.current = null;
        osc.dispose();
        rendered.dispose();
        scrolled.dispose();
        resized.dispose();
        marker.current?.dispose();
        marker.current = null;
        dismiss();
      };
    },
    [local, prefix, dismiss, container],
  );

  const onInput = useCallback(
    (data: string) => {
      dismiss();
      lastQuery.current = '';
      if (
        Array.from(data).some((character) =>
          [3, 4, 10, 13, 18, 26].includes(character.charCodeAt(0)),
        )
      ) {
        marker.current?.dispose();
        marker.current = null;
      }
    },
    [dismiss],
  );

  const accept = useCallback(
    (index: number) => {
      const current = suggestion.current;
      const item = current?.items[index];
      if (!current || !item || prefix() !== current.prefix || !session.current) return;
      window.mterminal.writeTerminal(session.current, {
        kind: 'text',
        data: item.command.slice(current.prefix.length),
      });
      dismiss();
      lastQuery.current = '';
      terminal.current?.focus();
    },
    [dismiss, prefix, session, terminal],
  );

  const handleKey = useCallback(
    (event: KeyboardEvent) => {
      const current = suggestion.current;
      if (
        !current ||
        event.type !== 'keydown' ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.shiftKey
      )
        return true;
      if (event.key === 'Escape') {
        dismiss();
        return false;
      }
      if (prefix() !== current.prefix) {
        dismiss();
        return true;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        current.index =
          (current.index + (event.key === 'ArrowDown' ? 1 : -1) + current.items.length) %
          current.items.length;
        setSelected(current.index);
        return false;
      }
      if (event.key === 'ArrowRight') {
        accept(current.index);
        return false;
      }
      if (event.key === 'Enter' || event.key === 'Tab') dismiss();
      return true;
    },
    [dismiss, prefix, accept],
  );

  useEffect(
    () =>
      window.mterminal.onVaultLocked(() => {
        vaultEpoch.current++;
        setEntries([]);
        setQuery('');
        setMessage('Unlock the local vault to use command history.');
        dismiss();
      }),
    [dismiss],
  );
  useEffect(
    () =>
      window.mterminal.onHistoryChanged(() => {
        dismiss();
        lastQuery.current = '';
        setEntries([]);
        setRevision((value) => value + 1);
        const term = terminal.current;
        if (term) term.refresh(0, term.rows - 1);
      }),
    [dismiss, terminal],
  );
  useEffect(() => {
    if (active) return;
    const frame = requestAnimationFrame(dismiss);
    return () => cancelAnimationFrame(frame);
  }, [active, dismiss]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const epoch = vaultEpoch.current;
    void window.mterminal
      .getHistoryEnabled()
      .then((value) => {
        if (!cancelled) setEnabled(value);
      })
      .catch(() => {});
    const pending = setTimeout(() => {
      void window.mterminal
        .searchHistory(query, directory.current)
        .then((value) => {
          if (!cancelled && vaultEpoch.current === epoch) {
            setEntries(value);
            setMessage('');
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setEntries([]);
            setMessage(error instanceof Error ? error.message : 'History is unavailable.');
          }
        });
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(pending);
    };
  }, [open, query, revision]);

  async function remove(id?: string) {
    if (
      !window.confirm(id ? 'Delete this saved command?' : 'Clear all saved local command history?')
    )
      return;
    try {
      if (id) await window.mterminal.deleteHistory(id);
      else await window.mterminal.clearHistory();
      setEntries(await window.mterminal.searchHistory(query, directory.current));
      dismiss();
      lastQuery.current = '';
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to delete history.');
    }
  }

  async function setRecording(value: boolean) {
    try {
      await window.mterminal.setHistoryEnabled(value);
      setEnabled(value);
      setMessage(value ? 'Open a new Bash terminal to start recording.' : 'Recording paused.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to enable history.');
    }
  }

  const integrationText =
    integration === 'ready'
      ? enabled
        ? 'Recording active in this tab'
        : 'Recording paused'
      : integration === 'disabled'
        ? 'Enable recording, then open a new Bash terminal.'
        : integration === 'unsupported'
          ? 'Choose /bin/bash in Settings and open a new terminal.'
          : 'Waiting for a Bash prompt…';

  function insert(entry: CommandHistoryEntry) {
    if (prefix() !== '' || !session.current || /[\r\n]/.test(entry.command)) {
      setMessage('Clear the Bash command line before inserting a single-line command.');
      return;
    }
    window.mterminal.writeTerminal(session.current, { kind: 'text', data: entry.command });
    terminal.current?.focus();
  }

  const listId = `${toolId}-suggestions`;
  useEffect(() => {
    const input = terminal.current?.textarea;
    if (!input || !popup) return;
    const names = ['aria-autocomplete', 'aria-controls', 'aria-activedescendant', 'aria-expanded'];
    const previous = names.map((name) => input.getAttribute(name));
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', listId);
    input.setAttribute('aria-activedescendant', `${listId}-${selected}`);
    input.setAttribute('aria-expanded', 'true');
    document.getElementById(`${listId}-${selected}`)?.scrollIntoView({ block: 'nearest' });
    return () =>
      names.forEach((name, index) => {
        const value = previous[index];
        if (value == null) input.removeAttribute(name);
        else input.setAttribute(name, value);
      });
  }, [popup, selected, terminal, listId]);

  const panel =
    open && local ? (
      <aside
        className="command-history"
        id={`${toolId}-tools`}
        aria-label="Terminal tools"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            terminal.current?.focus();
          }
        }}
      >
        <div className="history-toolbar">
          <div
            role="tablist"
            aria-label="Terminal tools"
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const next =
                event.key === 'Home'
                  ? 'history'
                  : event.key === 'End'
                    ? 'autocomplete'
                    : tool === 'history'
                      ? 'autocomplete'
                      : 'history';
              setTool(next);
              document.getElementById(`${toolId}-${next}`)?.focus();
            }}
          >
            <button
              type="button"
              role="tab"
              id={`${toolId}-history`}
              aria-selected={tool === 'history'}
              tabIndex={tool === 'history' ? 0 : -1}
              aria-controls={`${toolId}-panel`}
              aria-label="Command history"
              title="Command history"
              onClick={() => setTool('history')}
            >
              <Icon name="history" />
            </button>
            <button
              type="button"
              role="tab"
              id={`${toolId}-autocomplete`}
              aria-selected={tool === 'autocomplete'}
              tabIndex={tool === 'autocomplete' ? 0 : -1}
              aria-controls={`${toolId}-panel`}
              aria-label="Autocomplete settings"
              title="Autocomplete"
              onClick={() => setTool('autocomplete')}
            >
              <Icon name="rocket" />
            </button>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close terminal tools"
            onClick={() => {
              setOpen(false);
              terminal.current?.focus();
            }}
          >
            <Icon name="close" />
          </button>
        </div>
        <div
          role="tabpanel"
          id={`${toolId}-panel`}
          aria-labelledby={`${toolId}-${tool}`}
          className="history-tool-content"
        >
          {tool === 'history' ? (
            <>
              <label className="history-search">
                <Icon name="search" />
                <input
                  aria-label="Search command history"
                  placeholder="Search history"
                  value={query}
                  maxLength={4096}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <ul className="history-list">
                {entries.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      className="history-command"
                      title={`${entry.command}\n${entry.directory}`}
                      onClick={() => insert(entry)}
                    >
                      <Icon name="history" />
                      <code>{entry.command}</code>
                    </button>
                    <div className="history-entry-actions">
                      <button
                        type="button"
                        onClick={() => {
                          void window.mterminal
                            .writeClipboardText(entry.command)
                            .catch(() => setMessage('Unable to copy command.'));
                        }}
                      >
                        Copy
                      </button>
                      <button type="button" onClick={() => void remove(entry.id)}>
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              {!entries.length && (
                <div className="history-empty">
                  <Icon name="history" />
                  <p>No matching commands</p>
                  <small>Enable recording and run a command in a new Bash terminal.</small>
                  {!enabled && (
                    <>
                      <p className="history-help">
                        Commands may contain secrets. An unlocked vault is required.
                      </p>
                      <button
                        type="button"
                        className="primary-button"
                        onClick={() => void setRecording(true)}
                      >
                        Enable recording
                      </button>
                    </>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              <label className="autocomplete-setting">
                Autocomplete
                <select
                  aria-label="Autocomplete"
                  value={autocomplete ? 'enabled' : 'disabled'}
                  onChange={(event) => {
                    const value = event.target.value === 'enabled';
                    autocompleteRef.current = value;
                    setAutocomplete(value);
                    dismiss();
                    lastQuery.current = '';
                    terminal.current?.refresh(0, terminal.current.rows - 1);
                  }}
                >
                  <option value="enabled">Enabled</option>
                  <option value="disabled">Disabled</option>
                </select>
              </label>
              <p className="history-help">
                Suggestions appear beneath the cursor as you type at an integrated Bash prompt.
              </p>
              <dl className="autocomplete-shortcuts">
                <div>
                  <dt>↑ / ↓</dt>
                  <dd>Select suggestion</dd>
                </div>
                <div>
                  <dt>→</dt>
                  <dd>Insert suggestion</dd>
                </div>
                <div>
                  <dt>Esc</dt>
                  <dd>Dismiss</dd>
                </div>
                <div>
                  <dt>Enter</dt>
                  <dd>Run typed command</dd>
                </div>
              </dl>
            </>
          )}
        </div>
        <footer className="history-footer">
          <p className="history-session-status" role="status">
            {integrationText}
          </p>
          {message && (
            <p className="history-message" role="status">
              {message}
            </p>
          )}
          <details>
            <summary>Recording &amp; privacy</summary>
            <label className="history-recording">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => void setRecording(event.target.checked)}
              />{' '}
              Record local Bash commands
            </label>
            <p className="history-help">
              Opt-in for this app window. Commands may contain secrets. Stored in your encrypted
              vault for up to 30 days and 500 entries. A leading space excludes a command. SSH
              capture is unavailable.
            </p>
            <button type="button" className="history-clear" onClick={() => void remove()}>
              Clear history
            </button>
          </details>
        </footer>
      </aside>
    ) : null;
  const overlay =
    active && popup && container.current
      ? createPortal(
          <div
            className="command-suggestions"
            id={listId}
            role="listbox"
            aria-label="Command suggestions"
            style={{
              left: popup.left,
              top: popup.top,
              width: popup.width,
              maxHeight: popup.maxHeight,
            }}
          >
            {popup.items.map((item, index) => (
              <div
                key={item.id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={selected === index}
                className="command-suggestion"
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => {
                  if (suggestion.current) suggestion.current.index = index;
                  setSelected(index);
                }}
                onClick={() => accept(index)}
              >
                <Icon name="history" />
                <code>
                  <mark>{item.command.slice(0, popup.prefix.length)}</mark>
                  {item.command.slice(popup.prefix.length)}
                </code>
              </div>
            ))}
            <div className="suggestion-hint" aria-live="polite">
              ↑↓ select · → insert · Esc dismiss
            </div>
          </div>,
          container.current,
        )
      : null;
  return {
    attach,
    onInput,
    handleKey,
    onSessionStatus,
    panelId: `${toolId}-tools`,
    panel,
    overlay,
    toggle: () => setOpen((value) => !value),
    open,
  };
}
