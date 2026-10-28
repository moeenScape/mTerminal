import { SearchAddon } from '@xterm/addon-search';
import { TERMINAL_SCROLLBACK_LINES } from '../../../../shared/terminal';
import {
  TerminalSearch,
  MAX_SEARCH_QUERY,
  SEARCH_HIGHLIGHT_LIMIT,
  searchSummary,
  type SearchSummary,
} from './terminal-search';
import { useTerminalClipboard } from './use-terminal-clipboard';
import { PasteDialog } from './PasteDialog';
import type { TabPhase } from './tabs';
import { TerminalSizing } from './terminal-sizing';
import { isTerminalSearchShortcut, isWorkspaceShortcut } from '../../components/keyboard';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { terminalInputChunks, type TerminalInput } from '../../../../shared/terminal-input';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { failureMessages } from '../../../../shared/failures';

export function TerminalPane({
  id,
  title,
  onRequestClose,
  active,
  appearance,
  navigationShortcuts,
  onPhaseChange,
}: {
  id: string;
  title: string;
  onRequestClose: (id: string) => void;
  active: boolean;
  appearance: 'dark' | 'light';
  navigationShortcuts: boolean;
  onPhaseChange: (id: string, phase: TabPhase) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const sizing = useRef<TerminalSizing | null>(null);
  const search = useRef<TerminalSearch | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchFrame = useRef<number | undefined>(undefined);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [results, setResults] = useState<SearchSummary>({ index: -1, count: 0 });
  const openSearch = useCallback(() => {
    setSearchOpen(true);
    if (searchFrame.current !== undefined) cancelAnimationFrame(searchFrame.current);
    searchFrame.current = requestAnimationFrame(() => {
      if (searchInput.current?.clientWidth) {
        searchInput.current.focus();
        searchInput.current.select();
      }
    });
  }, []);
  const inputReady = useRef(false);
  const autoStarted = useRef(false);
  const session = useRef<string | null>(null);
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [status, setStatus] = useState('No active session');
  const [shells, setShells] = useState<string[]>([]);
  const { attach: attachClipboard, ...clipboard } = useTerminalClipboard(
    terminal,
    session,
    container,
    inputReady,
  );

  useEffect(() => {
    const host = container.current;
    if (!host) return;
    const term = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      fontFamily: '"DejaVu Sans Mono", Consolas, monospace',
      fontSize: 14,
      scrollback: TERMINAL_SCROLLBACK_LINES,
      screenReaderMode: true,
    });
    const addon = new FitAddon();
    term.loadAddon(addon);
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = '11';
    const finder = new SearchAddon({ highlightLimit: SEARCH_HIGHLIGHT_LIMIT });
    term.loadAddon(finder);
    term.open(host);
    const controller = new TerminalSearch(finder, term, setResults);
    search.current = controller;
    terminal.current = term;
    const disposeClipboard = attachClipboard(term, host);

    let disposed = false;
    void window.mterminal
      .getShells()
      .then((items) => {
        if (!disposed) setShells(items.map((item) => item.name));
      })
      .catch(() => {});
    const sizer = new TerminalSizing(
      host,
      term,
      () => addon.proposeDimensions(),
      (size) => {
        if (session.current) window.mterminal.resizeTerminal(session.current, size);
      },
    );
    sizing.current = sizer;
    const resize = () => sizer.schedule();
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    window.addEventListener('resize', resize);
    document.fonts.addEventListener('loadingdone', resize);
    void document.fonts.ready.then(resize).catch(() => {});
    let resolution = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const scaleChanged = () => {
      resolution.removeEventListener('change', scaleChanged);
      resolution = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      resolution.addEventListener('change', scaleChanged);
      resize();
    };
    resolution.addEventListener('change', scaleChanged);
    resize();
    const sendInput = (data: string, kind: TerminalInput['kind']) => {
      if (!session.current) return;
      for (const input of terminalInputChunks(data, kind))
        window.mterminal.writeTerminal(session.current, input);
    };
    // xterm generates control/escape sequences and commits composed text through onData.
    const input = term.onData((data) => sendInput(data, 'text'));
    const binary = term.onBinary((data) => sendInput(data, 'binary'));
    const unsubscribe = window.mterminal.onTerminalEvent((event) => {
      if (event.id !== session.current) return;
      if (event.kind === 'data') {
        term.write(event.data, () => {
          if (!disposed && session.current === event.id)
            window.mterminal.ackTerminal(event.id, event.data.length);
        });
      } else {
        inputReady.current = false;
        session.current = null;
        setRunning(false);
        setStarting(false);
        onPhaseChange(id, event.kind === 'exit' ? 'exited' : 'error');
        setStatus(
          event.kind === 'exit'
            ? `Shell exited (code ${event.exitCode})`
            : failureMessages[event.code],
        );
      }
    });
    return () => {
      disposed = true;
      disposeClipboard();
      controller.dispose();
      search.current = null;
      if (searchFrame.current !== undefined) cancelAnimationFrame(searchFrame.current);
      if (searchTimer.current !== undefined) clearTimeout(searchTimer.current);
      observer.disconnect();
      window.removeEventListener('resize', resize);
      document.fonts.removeEventListener('loadingdone', resize);
      resolution.removeEventListener('change', scaleChanged);
      sizer.dispose();
      input.dispose();
      binary.dispose();
      unsubscribe();
      if (session.current) window.mterminal.closeTerminal(session.current);
      inputReady.current = false;
      session.current = null;
      terminal.current = null;
      sizing.current = null;
      term.dispose();
    };
  }, [id, onPhaseChange, attachClipboard]);
  useEffect(() => {
    const term = terminal.current;
    if (!term) return;
    term.options.theme =
      appearance === 'light'
        ? { background: '#f5f6fa', foreground: '#182230', cursor: '#136c56' }
        : { background: '#141620', foreground: '#edf0f7', cursor: '#8bd8c0' };
  }, [appearance]);
  useEffect(() => {
    terminal.current?.attachCustomKeyEventHandler((event) => {
      if (isTerminalSearchShortcut(event)) {
        if (event.type === 'keydown') {
          event.preventDefault();
          openSearch();
        }
        return false;
      }
      return !(navigationShortcuts && isWorkspaceShortcut(event));
    });
  }, [navigationShortcuts, openSearch]);
  useEffect(() => {
    if (active) {
      sizing.current?.schedule();
    }
  }, [active]);

  useEffect(() => {
    if (!searchOpen) {
      search.current?.close();
      return;
    }
    const timer = setTimeout(() => search.current?.find(query, matchCase, false, true), 150);
    searchTimer.current = timer;
    return () => clearTimeout(timer);
  }, [searchOpen, query, matchCase]);
  function navigateSearch(previous = false) {
    if (searchTimer.current !== undefined) clearTimeout(searchTimer.current);
    search.current?.find(query, matchCase, previous);
  }
  function closeSearch() {
    setSearchOpen(false);
    search.current?.close();
    if (container.current?.clientWidth) terminal.current?.focus();
  }

  const start = useCallback(async () => {
    const term = terminal.current;
    if (!term || session.current) return;
    const size = sizing.current?.fitNow();
    if (!size) {
      setStatus(
        'Terminal layout is not ready. Wait for fonts or resize the window, then try again.',
      );
      onPhaseChange(id, 'error');
      return;
    }
    inputReady.current = false;
    setSearchOpen(false);
    setQuery('');
    search.current?.close();
    term.reset();
    const sessionId = crypto.randomUUID();
    session.current = sessionId;
    setStarting(true);
    onPhaseChange(id, 'starting');
    setStatus('Starting local shell…');
    try {
      await window.mterminal.openTerminal(sessionId, size);
      if (session.current !== sessionId) return;
      sizing.current?.fitNow(true);
      inputReady.current = true;
      setRunning(true);
      setStarting(false);
      onPhaseChange(id, 'running');
      setStatus('Local shell running');
      const panel = document.getElementById(`terminal-panel-${id}`);
      if (
        panel?.clientWidth &&
        panel.contains(document.activeElement) &&
        !document.activeElement?.closest('[role="search"], dialog')
      )
        term.focus();
    } catch (error) {
      if (session.current !== sessionId) return;
      inputReady.current = false;
      session.current = null;
      setStarting(false);
      onPhaseChange(id, 'error');
      const message =
        error instanceof Error &&
        Object.values(failureMessages).some((value) => value === error.message)
          ? error.message
          : failureMessages['terminal-failed'];
      setStatus(message);
    }
  }, [id, onPhaseChange]);
  useEffect(() => {
    if (!active || autoStarted.current) return;
    const frame = requestAnimationFrame(() => {
      autoStarted.current = true;
      void start();
    });
    return () => cancelAnimationFrame(frame);
  }, [active, start]);

  return (
    <div
      className="terminal-pane"
      hidden={!active}
      role="tabpanel"
      id={`terminal-panel-${id}`}
      aria-labelledby={`terminal-tab-${id}`}
    >
      <header className="terminal-toolbar">
        <p className="terminal-status" role="status">
          {status}
        </p>
        <div className="terminal-clipboard-tools">
          <button
            type="button"
            disabled={!clipboard.selected}
            onClick={() => void clipboard.copy()}
          >
            Copy selection
          </button>
          <button
            type="button"
            disabled={!running || clipboard.busy}
            onClick={() => void clipboard.paste()}
          >
            Paste
          </button>
          <button type="button" onClick={openSearch}>
            Search
          </button>
          <button
            type="button"
            aria-label="Scroll to bottom"
            onClick={() => {
              terminal.current?.scrollToBottom();
              terminal.current?.focus();
            }}
          >
            Bottom
          </button>
          <button type="button" onClick={() => terminal.current?.selectAll()}>
            Select all
          </button>
        </div>
        {running || starting ? (
          <button type="button" className="secondary-button" onClick={() => onRequestClose(id)}>
            {starting ? 'Cancel' : 'Close session'}
          </button>
        ) : (
          <button type="button" className="secondary-button" onClick={() => void start()}>
            Start local shell
          </button>
        )}
      </header>
      {searchOpen && (
        <form
          className="terminal-search"
          role="search"
          aria-label={`Search ${title}`}
          onSubmit={(event) => {
            event.preventDefault();
            navigateSearch();
          }}
        >
          <label htmlFor={`terminal-search-${id}`}>Find output</label>
          <input
            ref={searchInput}
            id={`terminal-search-${id}`}
            type="search"
            value={query}
            maxLength={MAX_SEARCH_QUERY}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                closeSearch();
              } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault();
                navigateSearch(event.shiftKey);
              }
            }}
          />
          <label className="search-case">
            <input
              type="checkbox"
              checked={matchCase}
              onChange={(event) => setMatchCase(event.target.checked)}
            />
            Match case
          </label>
          <span role="status">{searchSummary(query, results)}</span>
          <button
            type="button"
            disabled={!query || !results.count}
            onClick={() => navigateSearch(true)}
            aria-label="Previous match"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={!query || !results.count}
            onClick={() => navigateSearch()}
            aria-label="Next match"
          >
            Next
          </button>
          <button type="button" onClick={closeSearch} aria-label="Close terminal search">
            Close
          </button>
        </form>
      )}
      {clipboard.notice && (
        <p className="clipboard-notice" role="status">
          {clipboard.notice}
        </p>
      )}
      {!running && !starting && (
        <p className="shell-help">
          Installed shells: {shells.join(', ') || 'None discovered'}. The saved default shell is
          used when configured. Closing a session stops its foreground work.
        </p>
      )}
      <div className="terminal-container" ref={container} aria-label="Local terminal" />
      {clipboard.pending && (
        <PasteDialog
          title={title}
          paste={clipboard.pending}
          onConfirm={clipboard.confirm}
          onCancel={clipboard.cancel}
        />
      )}
    </div>
  );
}
