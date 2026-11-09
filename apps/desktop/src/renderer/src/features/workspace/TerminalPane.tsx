import { SshChallengeDialog } from './SshChallengeDialog';
import { SshPrompt } from './SshPrompt';
import { findSavedCredentials } from './saved-credentials';
import { ConnectionProgress, type ConnectionLog } from './ConnectionProgress';
import type { SshConnectionState } from '../../../../shared/terminal';
import type { SshCredentials, SshChallenge } from '../../../../shared/ssh';
import { defaultTerminalAppearance, terminalOptions } from './appearance';
import { TerminalTools, type ToolTab, type ToolsPreferences } from './TerminalTools';
import {
  ContextMenu,
  menuPositionFor,
  shortcutLabel,
  type MenuItem,
  type MenuPosition,
} from '../../components/ContextMenu';
import { Icon } from '../../components/Icon';
import { SearchAddon } from '@xterm/addon-search';
import { TERMINAL_SCROLLBACK_LINES, sshStateMessages } from '../../../../shared/terminal';
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
import { mirrorTerminalStyles } from './xterm-styles';
import { useCommandHistory } from './useCommandHistory';
import { FileBrowser } from '../files/FileBrowser';

export function TerminalPane({
  id,
  title,
  hostId,
  onRequestClose,
  onOpenVault,
  active,
  appearance,
  navigationShortcuts,
  onPhaseChange,
  toolsPreferences,
  onToolsPreferenceChange,
}: {
  id: string;
  title: string;
  hostId: string | undefined;
  onRequestClose: (id: string) => void;
  onOpenVault: () => Promise<void>;
  active: boolean;
  appearance: 'dark' | 'light';
  navigationShortcuts: boolean;
  onPhaseChange: (id: string, phase: TabPhase) => void;
  toolsPreferences: ToolsPreferences;
  onToolsPreferenceChange: (patch: Partial<ToolsPreferences>) => Promise<void>;
}) {
  const container = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const sizing = useRef<TerminalSizing | null>(null);
  const search = useRef<TerminalSearch | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchFrame = useRef<number | undefined>(undefined);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [searchOpen, setSearchOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [results, setResults] = useState<SearchSummary>({ index: -1, count: 0 });
  const openSearch = useCallback(() => {
    setFilesOpen(false);
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
  const options = terminalOptions(terminalAppearance, appearance);
  const history = useCommandHistory(
    active && !filesOpen,
    !hostId,
    session,
    inputReady,
    container,
    toolsPreferences.autocomplete,
    options.fontFamily,
  );
  const {
    attach: attachHistory,
    onInput: historyInput,
    handleKey: historyKey,
    onSessionStatus: historyStatus,
  } = history;
  const [tools, setTools] = useState<ToolTab | null>(null);
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [status, setStatus] = useState('No active session');
  const [sshPrompt, setSshPrompt] = useState(false);
  /** Why the connect dialog opened instead of connecting with saved credentials. */
  const [sshNotice, setSshNotice] = useState('');
  const lookingUp = useRef(false);
  /** Drives the full-pane connection screen while an SSH session starts. */
  const [connection, setConnection] = useState<{
    state: SshConnectionState | 'lookup';
    error: string;
    logs: ConnectionLog[];
  } | null>(null);
  const logConnection = useCallback(
    (text: string, patch: Partial<{ state: SshConnectionState | 'lookup'; error: string }> = {}) =>
      setConnection((current) => ({
        state: 'connecting',
        error: '',
        ...current,
        ...patch,
        logs: [...(current?.logs ?? []), { at: Date.now(), text }],
      })),
    [],
  );
  const [sshChallenge, setSshChallenge] = useState<SshChallenge | null>(null);
  const [menu, setMenu] = useState<MenuPosition | null>(null);
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
      ...terminalOptions(defaultTerminalAppearance, 'dark'),
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
    const disposeStyles = mirrorTerminalStyles(host);
    const controller = new TerminalSearch(finder, term, setResults);
    search.current = controller;
    terminal.current = term;
    const disposeHistory = attachHistory(term);
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
      historyInput(data);
      for (const input of terminalInputChunks(data, kind))
        window.mterminal.writeTerminal(session.current, input);
    };
    // xterm generates control/escape sequences and commits composed text through onData.
    const input = term.onData((data) => sendInput(data, 'text'));
    const binary = term.onBinary((data) => sendInput(data, 'binary'));
    const unsubscribe = window.mterminal.onTerminalEvent((event) => {
      if (event.id !== session.current) return;
      if (event.kind === 'state') {
        if (!hostId) return;
        onPhaseChange(id, event.state);
        setStatus(sshStateMessages[event.state]);
        if (event.state === 'connected') setConnection(null);
        else logConnection(sshStateMessages[event.state], { state: event.state });
      } else if (event.kind === 'data') {
        term.write(event.data, () => {
          if (!disposed && session.current === event.id)
            window.mterminal.ackTerminal(event.id, event.data.length);
        });
      } else if (event.kind === 'history-status') {
        historyStatus(event.status);
      } else if (event.kind === 'history-error') {
        setStatus(`Command history was not saved. ${failureMessages[event.code]}`);
      } else {
        setSshChallenge(null);
        inputReady.current = false;
        session.current = null;
        setRunning(false);
        setStarting(false);
        onPhaseChange(
          id,
          hostId
            ? event.kind === 'exit'
              ? (event.connectionState ?? 'disconnected')
              : 'failed'
            : event.kind === 'exit'
              ? 'exited'
              : 'error',
        );
        setStatus(
          event.kind === 'exit'
            ? event.failureCode
              ? failureMessages[event.failureCode]
              : hostId
                ? `SSH ${event.connectionState === 'failed' ? 'failed' : 'disconnected'} (code ${event.exitCode})`
                : `Shell exited (code ${event.exitCode})`
            : failureMessages[event.code],
        );
      }
    });
    return () => {
      disposed = true;
      disposeClipboard();
      disposeStyles();
      disposeHistory();
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
  }, [
    id,
    hostId,
    onPhaseChange,
    attachClipboard,
    attachHistory,
    historyInput,
    historyStatus,
    logConnection,
  ]);
  useEffect(() => {
    const term = terminal.current;
    if (!term) return;
    term.options = terminalOptions(terminalAppearance, appearance);
    sizing.current?.schedule();
  }, [appearance, terminalAppearance]);
  useEffect(() => {
    terminal.current?.attachCustomKeyEventHandler((event) => {
      if (!historyKey(event)) return false;
      if (isTerminalSearchShortcut(event)) {
        if (event.type === 'keydown') {
          event.preventDefault();
          openSearch();
        }
        return false;
      }
      return !(navigationShortcuts && isWorkspaceShortcut(event));
    });
  }, [navigationShortcuts, openSearch, historyKey]);
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
      if (!term || session.current || lookingUp.current) return;
      let usingSaved = false;
      if (hostId && !credentials) {
        // One click: connect with saved credentials when there are any, as in Termius.
        lookingUp.current = true;
        setStatus('Connecting SSH…');
        setConnection(null);
        logConnection('Looking for saved credentials', { state: 'lookup', error: '' });
        try {
          credentials = await findSavedCredentials(hostId).catch(() => undefined);
        } finally {
          lookingUp.current = false;
        }
        if (!credentials || session.current) {
          setConnection(null);
          setStatus('No active session');
          setSshNotice('');
          setSshPrompt(true);
          return;
        }
        usingSaved = true;
        logConnection('Using saved credentials');
      } else if (hostId) {
        setConnection(null);
        logConnection('Using the credentials you entered', { state: 'connecting', error: '' });
      }
      setSshPrompt(false);
      setSshNotice('');
      const size = sizing.current?.fitNow();
      if (!size) {
        setStatus(
          'Terminal layout is not ready. Wait for fonts or resize the window, then try again.',
        );
        onPhaseChange(id, hostId ? 'failed' : 'error');
        return;
      }
      inputReady.current = false;
      setSearchOpen(false);
      setQuery('');
      search.current?.close();
      term.reset();
      const sessionId = crypto.randomUUID();
      session.current = sessionId;
      setAttempted(true);
      setStarting(true);
      onPhaseChange(id, hostId ? 'connecting' : 'starting');
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
        onPhaseChange(id, hostId ? 'connected' : 'running');
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
        const cancelled =
          hostId && error instanceof Error && error.message === failureMessages['ssh-cancelled'];
        onPhaseChange(id, hostId ? (cancelled ? 'disconnected' : 'failed') : 'error');
        const message =
          error instanceof Error &&
          Object.values(failureMessages).some((value) => value === error.message)
            ? error.message
            : failureMessages['terminal-failed'];
        setStatus(cancelled ? message : hostId ? `SSH failed. ${message}` : message);
        if (hostId) {
          if (cancelled) setConnection(null);
          else logConnection(`Failed: ${message}`, { error: message });
        }
        if (
          usingSaved &&
          error instanceof Error &&
          (error.message === failureMessages['ssh-auth-failed'] ||
            error.message === failureMessages['vault-secret-missing'] ||
            error.message === failureMessages['vault-locked'])
        ) {
          setSshNotice(
            error.message === failureMessages['ssh-auth-failed']
              ? 'The saved password was not accepted. Enter the current password; it will replace the saved one.'
              : 'The saved password could not be read. Enter it again to connect.',
          );
          setConnection(null);
          setSshPrompt(true);
        }
      }
    },
    [id, onPhaseChange, hostId, logConnection],
  );
  useEffect(() => {
    if (!active || autoStarted.current) return;
    const frame = requestAnimationFrame(() => {
      autoStarted.current = true;
      void start();
    });
    return () => cancelAnimationFrame(frame);
  }, [active, start]);

  function cancelConnection(expectedId = session.current) {
    if (!hostId || !expectedId || session.current !== expectedId) return;
    session.current = null;
    inputReady.current = false;
    setSshChallenge(null);
    setSshPrompt(false);
    setConnection(null);
    setStarting(false);
    setRunning(false);
    onPhaseChange(id, 'disconnected');
    setStatus(failureMessages['ssh-cancelled']);
    window.mterminal.closeTerminal(expectedId);
  }

  const menuItems: MenuItem[] = [
    {
      label: 'Copy',
      shortcut: shortcutLabel('C'),
      disabled: !clipboard.selected,
      onSelect: () => void clipboard.copy(),
    },
    {
      label: 'Paste',
      shortcut: shortcutLabel('V'),
      disabled: !running || clipboard.busy,
      onSelect: () => void clipboard.paste(),
    },
    {
      label: 'Select all',
      shortcut: shortcutLabel('A'),
      onSelect: () => terminal.current?.selectAll(),
    },
    { label: 'Find…', shortcut: shortcutLabel('F'), separator: true, onSelect: openSearch },
    {
      label: 'Scroll to bottom',
      onSelect: () => {
        terminal.current?.scrollToBottom();
        terminal.current?.focus();
      },
    },
    {
      label: 'Command history',
      separator: true,
      onSelect: () => {
        setFilesOpen(false);
        setTools('history');
      },
    },
    {
      label: 'Terminal appearance…',
      onSelect: () => {
        setFilesOpen(false);
        setTools('themes');
      },
    },
    {
      label: 'Browse files',
      onSelect: () => {
        setTools(null);
        setFilesOpen(true);
      },
    },
    {
      label: running || starting ? 'Close session' : 'Close tab',
      danger: true,
      separator: true,
      onSelect: () => onRequestClose(id),
    },
  ];

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
          onCancel={() => cancelConnection(sshChallenge.id)}
        />
      )}
      {sshPrompt && (
        <SshPrompt
          key={`${hostId}:${sshNotice}`}
          title={title}
          reconnect={attempted}
          hostId={hostId!}
          notice={sshNotice}
          onConnect={(credentials) => void start(credentials)}
          onCancel={() => setSshPrompt(false)}
          onOpenVault={onOpenVault}
        />
      )}
      <header className="pane-bar">
        <p className="terminal-status" role="status">
          {status}
        </p>
        {starting ? (
          <button
            type="button"
            className="secondary-button pane-bar-action"
            onClick={() => {
              if (hostId) cancelConnection();
              else onRequestClose(id);
            }}
          >
            {hostId ? 'Cancel connection' : 'Cancel'}
          </button>
        ) : (
          !running && (
            <button
              type="button"
              className="primary-button pane-bar-action"
              onClick={() => void start()}
            >
              {hostId ? (attempted ? 'Reconnect SSH' : 'Connect SSH') : 'Start local shell'}
            </button>
          )
        )}
        <button
          type="button"
          className="icon-button"
          aria-label="Search"
          title={`Find in output (${shortcutLabel('F')})`}
          onClick={openSearch}
        >
          <Icon name="search" />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Terminal tools"
          aria-expanded={tools !== null}
          aria-controls={`terminal-tools-${id}`}
          title="Autocomplete, history and themes"
          onClick={() => {
            setFilesOpen(false);
            setTools((value) => (value ? null : 'history'));
          }}
        >
          <Icon name="panel" />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Files"
          title="Browse local and SFTP files"
          aria-expanded={filesOpen}
          aria-controls={`files-${id}`}
          onClick={() => {
            setFilesOpen((value) => !value);
            setTools(null);
          }}
        >
          <Icon name="folder" />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="More actions"
          aria-haspopup="menu"
          aria-expanded={menu !== null}
          title="More actions (or right-click the terminal)"
          onClick={(event) => setMenu(menuPositionFor(event.currentTarget))}
        >
          <Icon name="more" />
        </button>
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
        <p className="shell-help" hidden={!!hostId}>
          Installed shells: {shells.join(', ') || 'None discovered'}. The saved default shell is
          used when configured. Closing a session stops its foreground work.
        </p>
      )}
      <div className="terminal-stage">
        <div
          className="terminal-container"
          inert={filesOpen}
          ref={container}
          style={{ background: options.theme.background }}
          aria-label={hostId ? 'SSH terminal' : 'Local terminal'}
          onContextMenu={(event) => {
            event.preventDefault();
            setMenu({ x: event.clientX, y: event.clientY });
          }}
        />
        {history.overlay}
        {filesOpen && (
          <div className="files-overlay" id={`files-${id}`}>
            <FileBrowser
              remote={!!hostId}
              sessionId={hostId && running ? session.current : null}
              remoteTitle={title}
              onClose={() => {
                setFilesOpen(false);
                terminal.current?.focus();
              }}
            />
          </div>
        )}
        {hostId && connection && !sshPrompt && (
          <ConnectionProgress
            hostId={hostId}
            title={title}
            state={connection.state}
            error={connection.error}
            logs={connection.logs}
            onCancel={() => {
              if (session.current) cancelConnection();
              else setConnection(null);
            }}
            onRetry={() => {
              setConnection(null);
              void start();
            }}
            onClose={() => setConnection(null)}
          />
        )}
        {tools && (
          <TerminalTools
            id={id}
            title={title}
            tab={tools}
            onTabChange={setTools}
            onClose={() => {
              setTools(null);
              terminal.current?.focus();
            }}
            local={!hostId}
            integration={history.integration}
            directory={history.directory}
            onInsert={history.insert}
            preferences={toolsPreferences}
            onPreferenceChange={onToolsPreferenceChange}
            appearance={terminalAppearance}
            applicationTheme={appearance}
            onAppearanceChange={setTerminalAppearance}
          />
        )}
      </div>
      {clipboard.pending && (
        <PasteDialog
          title={title}
          paste={clipboard.pending}
          onConfirm={clipboard.confirm}
          onCancel={clipboard.cancel}
        />
      )}
      {menu && (
        <ContextMenu
          label={`Actions for ${title}`}
          position={menu}
          items={menuItems}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
