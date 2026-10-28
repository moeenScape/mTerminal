import { useTerminalClipboard } from './use-terminal-clipboard';
import { PasteDialog } from './PasteDialog';
import type { TabPhase } from './tabs';
import { TerminalSizing } from './terminal-sizing';
import { isWorkspaceShortcut } from '../../components/keyboard';
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
      scrollback: 3000,
      screenReaderMode: true,
    });
    const addon = new FitAddon();
    term.loadAddon(addon);
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = '11';
    term.open(host);
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
    terminal.current?.attachCustomKeyEventHandler(
      (event) => !(navigationShortcuts && isWorkspaceShortcut(event)),
    );
  }, [navigationShortcuts]);
  useEffect(() => {
    if (active) {
      sizing.current?.schedule();
    }
  }, [active]);

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
      if (panel?.clientWidth && panel.contains(document.activeElement)) term.focus();
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
