import { shellMarker, type ShellIntegrationState } from '../../../../shared/shell-integration';
import { useCallback, useEffect, useRef, useState, useId, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../components/Icon';
import { autocompleteMatches, autocompletePosition } from './autocomplete';
import type { Terminal, IMarker } from '@xterm/xterm';
import type { CommandHistoryEntry } from '../../../../shared/history';

export type HistoryIntegration = 'unknown' | 'unsupported' | 'starting' | 'ready';

/**
 * Inline history suggestions for local Bash prompts. The shell integration marks where each
 * prompt ends (OSC 777), so the typed command can be read back from the terminal buffer.
 */
export function useCommandHistory(
  active: boolean,
  local: boolean,
  session: RefObject<string | null>,
  ready: RefObject<boolean>,
  container: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  fontFamily: string,
) {
  const listId = `${useId()}-suggestions`;
  const terminal = useRef<Terminal | null>(null);
  const [integration, setIntegration] = useState<HistoryIntegration>('unknown');
  const [shellState, setShellState] = useState<ShellIntegrationState>({
    phase: local ? 'unknown' : 'unsupported',
    directory: '',
    lastExitCode: null,
  });
  const enabledRef = useRef(enabled);
  const [selected, setSelected] = useState(-1);
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
  const swallowEnter = useRef(false);

  const dismiss = useCallback(() => {
    version.current++;
    clearTimeout(timer.current);
    suggestion.current = null;
    setPopup(null);
  }, []);

  const onSessionStatus = useCallback(
    (status: 'unsupported' | 'starting' | 'unknown') => {
      marker.current?.dispose();
      marker.current = null;
      directory.current = '';
      lastQuery.current = '';
      dismiss();
      setIntegration(status);
      setShellState({ phase: status, directory: '', lastExitCode: null });
    },
    [dismiss],
  );

  /** The text typed after the prompt, or undefined when the cursor is not at a clean prompt. */
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
  }, [ready]);

  useEffect(() => {
    enabledRef.current = enabled;
    lastQuery.current = '';
    // Re-rendering the terminal re-runs the suggestion check with the new setting.
    const term = terminal.current;
    if (term) term.refresh(0, term.rows - 1);
  }, [enabled]);

  const attach = useCallback(
    (term: Terminal) => {
      if (!local) return () => {};
      terminal.current = term;
      const render = () => {
        const text = prefix();
        if (!enabledRef.current || !text || text.startsWith(' ')) {
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
            .searchHistory(text, directory.current, 'prefix')
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
              suggestion.current = { prefix: text, items: matches, index: -1 };
              setSelected(-1);
              setPopup({ prefix: text, items: matches, ...position });
            })
            .catch(() => {
              if (request === version.current) dismiss();
            });
        }, 100);
      };
      const osc = term.parser.registerOscHandler(777, (data) => {
        if (!data.startsWith('mterminal;')) return false;
        const state = shellMarker(data, session.current);
        if (!state) return true;
        dismiss();
        marker.current?.dispose();
        marker.current = null;
        lastQuery.current = '';
        if (state.kind === 'unavailable') {
          directory.current = '';
          setIntegration((previous) => (previous === 'ready' ? previous : 'unsupported'));
          setShellState({ phase: 'unknown', directory: '', lastExitCode: null });
        } else if (state.kind === 'running') {
          setShellState((previous) => ({ ...previous, phase: 'running' }));
        } else {
          directory.current = state.directory;
          marker.current = term.registerMarker(0) ?? null;
          column.current = term.buffer.active.cursorX;
          setIntegration('ready');
          setShellState({
            phase: 'prompt',
            directory: state.directory,
            lastExitCode: state.exitCode,
          });
        }
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
        onSessionStatus('unknown');
        terminal.current = null;
        osc.dispose();
        rendered.dispose();
        scrolled.dispose();
        resized.dispose();
      };
    },
    [local, prefix, dismiss, container, onSessionStatus, session],
  );

  const onInput = useCallback(
    (data: string) => {
      dismiss();
      lastQuery.current = '';
      // Enter, Ctrl+C/D/R/Z and line feeds end the current prompt.
      if (
        Array.from(data).some((character) =>
          [3, 4, 10, 13, 18, 26].includes(character.charCodeAt(0)),
        )
      ) {
        marker.current?.dispose();
        marker.current = null;
        setShellState((previous) =>
          previous.phase === 'prompt' ? { ...previous, phase: 'waiting' } : previous,
        );
      }
    },
    [dismiss],
  );

  const accept = useCallback(
    /** Types the rest of a suggestion; with `run`, also presses Enter to execute it. */
    (index: number, run = false) => {
      const current = suggestion.current;
      const item = current?.items[index];
      if (!current || !item || prefix() !== current.prefix || !session.current) return;
      window.mterminal.writeTerminal(session.current, {
        kind: 'text',
        data: item.command.slice(current.prefix.length) + (run ? '\r' : ''),
      });
      if (run) {
        // The command was submitted, so this prompt is finished.
        marker.current?.dispose();
        marker.current = null;
        setShellState((previous) => ({ ...previous, phase: 'waiting' }));
      }
      dismiss();
      lastQuery.current = '';
      terminal.current?.focus();
    },
    [dismiss, prefix, session],
  );

  const handleKey = useCallback(
    (event: KeyboardEvent) => {
      // xterm also turns Enter's keypress into input; drop it after Enter ran a suggestion.
      if (swallowEnter.current && event.type === 'keypress' && event.key === 'Enter') {
        swallowEnter.current = false;
        return false;
      }
      if (event.type === 'keydown') swallowEnter.current = false;
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
      const count = current.items.length;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        current.index =
          event.key === 'ArrowDown'
            ? (current.index + 1) % count
            : current.index < 0
              ? count - 1
              : (current.index - 1 + count) % count;
        setSelected(current.index);
        return false;
      }
      if (event.key === 'ArrowRight') {
        accept(Math.max(0, current.index));
        return false;
      }
      if (event.key === 'Enter' && current.index >= 0) {
        // A highlighted suggestion runs as the full command, as in Termius.
        event.preventDefault();
        swallowEnter.current = true;
        accept(current.index, true);
        return false;
      }
      if (event.key === 'Enter' || event.key === 'Tab') dismiss();
      return true;
    },
    [dismiss, prefix, accept],
  );

  const insertionError = useCallback((): string | undefined => {
    if (!session.current || !ready.current) return 'Start the session before inserting a command.';
    if (local && (integration === 'ready' || integration === 'starting') && prefix() !== '')
      return 'Clear the command line and return to an empty shell prompt first.';
    return undefined;
  }, [session, ready, local, integration, prefix]);

  /**
   * Types a command at the prompt without running it. Local Bash tabs require an empty
   * prompt; other sessions receive the text as typed input. Returns an error message.
   */
  const insert = useCallback(
    (command: string): string | undefined => {
      const error = insertionError();
      if (error) return error;
      if (!session.current) return 'The target session is no longer available.';
      if (/[\r\n]/.test(command)) return 'Multi-line commands can be copied but not inserted.';
      window.mterminal.writeTerminal(session.current, { kind: 'text', data: command });
      terminal.current?.focus();
      return undefined;
    },
    [session, insertionError],
  );

  const getDirectory = useCallback(() => directory.current, []);

  useEffect(
    () =>
      window.mterminal.onHistoryChanged(() => {
        dismiss();
        lastQuery.current = '';
        const term = terminal.current;
        if (term) term.refresh(0, term.rows - 1);
      }),
    [dismiss],
  );
  useEffect(() => window.mterminal.onVaultLocked(dismiss), [dismiss]);
  useEffect(() => {
    if (active) return;
    const frame = requestAnimationFrame(dismiss);
    return () => cancelAnimationFrame(frame);
  }, [active, dismiss]);

  useEffect(() => {
    const input = terminal.current?.textarea;
    if (!input || !popup) return;
    const names = ['aria-autocomplete', 'aria-controls', 'aria-activedescendant', 'aria-expanded'];
    const previous = names.map((name) => input.getAttribute(name));
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', listId);
    input.setAttribute('aria-expanded', 'true');
    if (selected >= 0) {
      input.setAttribute('aria-activedescendant', `${listId}-${selected}`);
      document.getElementById(`${listId}-${selected}`)?.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
    return () =>
      names.forEach((name, index) => {
        const value = previous[index];
        if (value == null) input.removeAttribute(name);
        else input.setAttribute(name, value);
      });
  }, [popup, selected, listId]);

  const overlay =
    active && popup && container.current
      ? createPortal(
          <div
            className="command-suggestions"
            id={listId}
            role="listbox"
            aria-label="Command suggestions"
            aria-description="Up and Down select, Right Arrow inserts, Enter runs the selected command, Escape dismisses."
            style={{
              left: popup.left,
              top: popup.top,
              width: popup.width,
              maxHeight: popup.maxHeight,
              fontFamily,
            }}
          >
            {popup.items.map((item, index) => (
              <div
                key={item.id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={selected === index}
                className="command-suggestion"
                title={item.command}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => {
                  if (suggestion.current) suggestion.current.index = index;
                  setSelected(index);
                }}
                onClick={() => accept(index)}
              >
                <Icon name="history" />
                <span className="command-suggestion-text">
                  <mark>{item.command.slice(0, popup.prefix.length)}</mark>
                  {item.command.slice(popup.prefix.length)}
                </span>
              </div>
            ))}
          </div>,
          container.current,
        )
      : null;

  return {
    attach,
    onInput,
    handleKey,
    onSessionStatus,
    overlay,
    integration,
    shellState,
    insert,
    insertionError,
    directory: getDirectory,
  };
}
