import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { Terminal, IMarker } from '@xterm/xterm';
import type { CommandHistoryEntry } from '../../../../shared/history';

export function useCommandHistory(
  active: boolean,
  local: boolean,
  terminal: RefObject<Terminal | null>,
  session: RefObject<string | null>,
  ready: RefObject<boolean>,
  container: RefObject<HTMLDivElement | null>,
) {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<CommandHistoryEntry[]>([]);
  const [message, setMessage] = useState('');
  const [revision, setRevision] = useState(0);
  const [ghost, setGhost] = useState<{
    suffix: string;
    left: number;
    top: number;
    lineHeight: number;
  } | null>(null);
  const marker = useRef<IMarker | null>(null);
  const column = useRef(0);
  const directory = useRef('');
  const suggestion = useRef<{ prefix: string; suffix: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const version = useRef(0);
  const lastQuery = useRef('');
  const vaultEpoch = useRef(0);

  const dismiss = useCallback(() => {
    version.current++;
    clearTimeout(timer.current);
    suggestion.current = null;
    setGhost(null);
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
      const render = () => {
        const text = prefix();
        if (!text || text.startsWith(' ')) {
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
              const item = items.find(
                (entry) => entry.command.length > text.length && !/[\r\n]/.test(entry.command),
              );
              const screen = container.current?.querySelector<HTMLElement>('.xterm-screen');
              const host = container.current;
              if (!item || !screen || !host) return;
              const rect = screen.getBoundingClientRect();
              const parent = host.getBoundingClientRect();
              const suffix = item.command.slice(text.length);
              suggestion.current = { prefix: text, suffix };
              setGhost({
                suffix,
                left:
                  rect.left - parent.left + (term.buffer.active.cursorX * rect.width) / term.cols,
                top: rect.top - parent.top + (term.buffer.active.cursorY * rect.height) / term.rows,
                lineHeight: rect.height / term.rows,
              });
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
      if (event.key !== 'ArrowRight' || prefix() !== current.prefix || !session.current)
        return true;
      window.mterminal.writeTerminal(session.current, { kind: 'text', data: current.suffix });
      dismiss();
      lastQuery.current = '';
      return false;
    },
    [dismiss, prefix, session],
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
      }),
    [dismiss],
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

  const panel =
    open && local ? (
      <section className="command-history" aria-label="Command history">
        <div className="history-actions">
          <strong>Local command history</strong>
          <button type="button" onClick={() => setOpen(false)}>
            Close history
          </button>
        </div>
        <p>
          Recording is opt-in for new Bash 5+ sessions until mTerminal quits. Commands may contain
          secrets. History is encrypted in your vault, limited to 500 entries and retained for 30
          days. Prefix a command with a space to exclude it. SSH recording is unavailable.
        </p>
        <label>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => {
              const value = event.target.checked;
              void window.mterminal
                .setHistoryEnabled(value)
                .then(() => {
                  setEnabled(value);
                  setMessage(
                    value
                      ? 'Enabled. Open a new local Bash terminal to start recording.'
                      : 'Recording paused for all sessions.',
                  );
                })
                .catch((error: unknown) =>
                  setMessage(error instanceof Error ? error.message : 'Unable to enable history.'),
                );
            }}
          />{' '}
          Record commands in new Bash sessions
        </label>
        <input
          aria-label="Search command history"
          placeholder="Search by command prefix"
          value={query}
          maxLength={4096}
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
        />
        <p role="status">
          {message ||
            (entries.length
              ? 'Right Arrow accepts a suggestion; Escape dismisses it. Commands are never executed automatically.'
              : 'No matching commands.')}
        </p>
        <ul>
          {entries.map((entry) => (
            <li key={entry.id}>
              <code>{entry.command}</code>
              <small>
                {entry.directory} · {entry.uses} uses
              </small>
              <div className="history-actions">
                <button
                  type="button"
                  onClick={() => {
                    if (prefix() !== '' || !session.current || /[\r\n]/.test(entry.command)) {
                      setMessage(
                        'Insert requires an empty integrated Bash prompt and a single-line command.',
                      );
                      return;
                    }
                    window.mterminal.writeTerminal(session.current, {
                      kind: 'text',
                      data: entry.command,
                    });
                    setOpen(false);
                    terminal.current?.focus();
                  }}
                >
                  Insert
                </button>
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
        <button type="button" onClick={() => void remove()}>
          Clear all history
        </button>
      </section>
    ) : null;
  const overlay =
    active && ghost && container.current
      ? createPortal(
          <span
            className="command-ghost"
            aria-hidden="true"
            style={{
              left: ghost.left,
              top: ghost.top,
              fontFamily: terminal.current?.options.fontFamily,
              fontSize: terminal.current?.options.fontSize,
              lineHeight: `${ghost.lineHeight}px`,
              color: terminal.current?.options.theme?.foreground,
            }}
          >
            {ghost.suffix}
          </span>,
          container.current,
        )
      : null;
  return {
    attach,
    onInput,
    handleKey,
    panel,
    overlay,
    toggle: () => setOpen((value) => !value),
    open,
  };
}
