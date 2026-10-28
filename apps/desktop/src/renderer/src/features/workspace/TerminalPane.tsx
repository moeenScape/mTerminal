import { SshChallengeDialog } from './SshChallengeDialog';
import { SshPrompt } from './SshPrompt';
import type { SshCredentials, SshChallenge } from '../../../../shared/ssh';
import {
  defaultTerminalAppearance,
  terminalOptions,
  type TerminalTheme,
  type TerminalFont,
  type TerminalCursor,
} from './appearance';
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
  hostId,
  onRequestClose,
  active,
  appearance,
  navigationShortcuts,
  onPhaseChange,
}: {
  id: string;
  title: string;
  hostId: string | undefined;
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
  const [terminalAppearance, setTerminalAppearance] = useState(defaultTerminalAppearance);
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [status, setStatus] = useState('No active session');
  const [sshPrompt, setSshPrompt] = useState(false);
  const [sshChallenge, setSshChallenge] = useState<SshChallenge | null>(null);
  useEffect(
    () =>
      window.mterminal.onSshChallenge((challenge) => {
        if (challenge.id === session.current) setSshChallenge(challenge);
      }),
    [],
  );
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
        setSshChallenge(null);
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
    term.options = terminalOptions(terminalAppearance, appearance);
    sizing.current?.schedule();
  }, [appearance, terminalAppearance]);
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

  const start = useCallback(
    async (credentials?: SshCredentials) => {
      const term = terminal.current;
      if (!term || session.current) return;
      if (hostId && !credentials) {
        setSshPrompt(true);
        return;
      }
      setSshPrompt(false);
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
      setStatus(hostId ? 'Connecting SSH…' : 'Starting local shell…');
      try {
        if (hostId && credentials)
          await window.mterminal.openSshTerminal(sessionId, size, hostId, credentials);
        else await window.mterminal.openTerminal(sessionId, size);
        if (session.current !== sessionId) return;
        sizing.current?.fitNow(true);
        inputReady.current = true;
        setRunning(true);
        setStarting(false);
        onPhaseChange(id, 'running');
        setStatus(hostId ? 'SSH connected' : 'Local shell running');
        const panel = document.getElementById(`terminal-panel-${id}`);
        if (
          panel?.clientWidth &&
          panel.contains(document.activeElement) &&
          !document.activeElement?.closest('[role="search"], dialog')
        )
          term.focus();
      } catch (error) {
        if (session.current !== sessionId) return;
        setSshChallenge(null);
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
    },
    [id, onPhaseChange, hostId],
  );
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
      {sshChallenge && (
        <SshChallengeDialog
          key={sshChallenge.token}
          title={title}
          challenge={sshChallenge}
          onAnswer={(answers) => {
            if (session.current === sshChallenge.id)
              window.mterminal.answerSshChallenge(sshChallenge.id, sshChallenge.token, answers);
            setSshChallenge(null);
          }}
          onCancel={() => {
            if (session.current === sshChallenge.id)
              window.mterminal.closeTerminal(sshChallenge.id);
            setSshChallenge(null);
          }}
        />
      )}
      {sshPrompt && (
        <SshPrompt
          title={title}
          hostId={hostId!}
          onConnect={(credentials) => void start(credentials)}
          onCancel={() => setSshPrompt(false)}
        />
      )}
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
            {hostId ? 'Connect SSH' : 'Start local shell'}
          </button>
        )}
      </header>
      <details className="terminal-appearance">
        <summary>Terminal appearance</summary>
        <div className="appearance-controls">
          <label>
            Theme
            <select
              value={terminalAppearance.theme}
              onChange={(event) =>
                setTerminalAppearance({
                  ...terminalAppearance,
                  theme: event.target.value as TerminalTheme,
                })
              }
            >
              <option value="system">Follow app</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </label>
          <label>
            Font
            <select
              value={terminalAppearance.font}
              onChange={(event) =>
                setTerminalAppearance({
                  ...terminalAppearance,
                  font: event.target.value as TerminalFont,
                })
              }
            >
              <option value="default">Default</option>
              <option value="monospace">System monospace</option>
              <option value="dejavu">DejaVu Sans Mono</option>
            </select>
          </label>
          <label>
            Font size
            <select
              value={terminalAppearance.fontSize}
              onChange={(event) =>
                setTerminalAppearance({
                  ...terminalAppearance,
                  fontSize: Number(event.target.value),
                })
              }
            >
              {[10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24].map((size) => (
                <option key={size} value={size}>
                  {size}px
                </option>
              ))}
            </select>
          </label>
          <label>
            Zoom
            <select
              value={terminalAppearance.zoom}
              onChange={(event) =>
                setTerminalAppearance({ ...terminalAppearance, zoom: Number(event.target.value) })
              }
            >
              {[75, 90, 100, 110, 125, 150].map((zoom) => (
                <option key={zoom} value={zoom}>
                  {zoom}%
                </option>
              ))}
            </select>
          </label>
          <label>
            Cursor
            <select
              value={terminalAppearance.cursor}
              onChange={(event) =>
                setTerminalAppearance({
                  ...terminalAppearance,
                  cursor: event.target.value as TerminalCursor,
                })
              }
            >
              <option value="block">Block</option>
              <option value="bar">Bar</option>
              <option value="underline">Underline</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={terminalAppearance.blink}
              onChange={(event) =>
                setTerminalAppearance({ ...terminalAppearance, blink: event.target.checked })
              }
            />
            Blink cursor
          </label>
          <button type="button" onClick={() => setTerminalAppearance(defaultTerminalAppearance)}>
            Reset appearance
          </button>
        </div>
        <p>Changes apply to this terminal tab for this app session.</p>
      </details>
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
        <p className="shell-help" hidden={!!hostId}>
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
