import { isWorkspaceShortcut } from '../../components/keyboard';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { terminalInputChunks, type TerminalInput } from '../../../../shared/terminal-input';
import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { failureMessages } from '../../../../shared/failures';

export function WorkspaceView({
  active,
  appearance,
  navigationShortcuts,
  onRunningChange,
}: {
  active: boolean;
  appearance: 'dark' | 'light';
  navigationShortcuts: boolean;
  onRunningChange: (running: boolean) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const session = useRef<string | null>(null);
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [status, setStatus] = useState('No active session');
  const [shells, setShells] = useState<string[]>([]);

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
    fit.current = addon;
    let disposed = false;
    void window.mterminal
      .getShells()
      .then((items) => {
        if (!disposed) setShells(items.map((item) => item.name));
      })
      .catch(() => {});
    const resize = () => {
      if (!host.clientWidth || !host.clientHeight) return;
      addon.fit();
      if (session.current)
        window.mterminal.resizeTerminal(session.current, {
          cols: Math.min(term.cols, 500),
          rows: Math.min(term.rows, 300),
        });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
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
        session.current = null;
        setRunning(false);
        setStarting(false);
        onRunningChange(false);
        setStatus(
          event.kind === 'exit'
            ? `Shell exited (code ${event.exitCode})`
            : failureMessages[event.code],
        );
      }
    });
    return () => {
      disposed = true;
      observer.disconnect();
      input.dispose();
      binary.dispose();
      unsubscribe();
      if (session.current) window.mterminal.closeTerminal(session.current);
      session.current = null;
      terminal.current = null;
      fit.current = null;
      term.dispose();
    };
  }, [onRunningChange]);
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
    if (active && terminal.current && session.current) {
      fit.current?.fit();
      terminal.current.focus();
    }
  }, [active]);

  async function start() {
    const term = terminal.current;
    if (!term || session.current) return;
    fit.current?.fit();
    term.reset();
    const id = crypto.randomUUID();
    session.current = id;
    setStarting(true);
    setStatus('Starting local shell…');
    try {
      await window.mterminal.openTerminal(id, {
        cols: Math.max(2, Math.min(term.cols, 500)),
        rows: Math.max(1, Math.min(term.rows, 300)),
      });
      if (session.current !== id) return;
      setRunning(true);
      setStarting(false);
      onRunningChange(true);
      setStatus('Local shell running');
      term.focus();
    } catch (error) {
      if (session.current !== id) return;
      session.current = null;
      setStarting(false);
      const message =
        error instanceof Error &&
        Object.values(failureMessages).some((value) => value === error.message)
          ? error.message
          : failureMessages['terminal-failed'];
      setStatus(message);
    }
  }
  function stop() {
    if (session.current) window.mterminal.closeTerminal(session.current);
    session.current = null;
    setRunning(false);
    setStarting(false);
    onRunningChange(false);
    setStatus('Session closed');
  }
  return (
    <div className="local-workspace" hidden={!active}>
      <header className="terminal-toolbar">
        <div>
          <h1>Workspace</h1>
          <span>Local terminal</span>
        </div>
        {running || starting ? (
          <button type="button" className="secondary-button" onClick={stop}>
            {starting ? 'Cancel' : 'Close session'}
          </button>
        ) : (
          <button type="button" className="secondary-button" onClick={() => void start()}>
            Start local shell
          </button>
        )}
      </header>
      <p className="terminal-status" role="status">
        {status}
      </p>
      {!running && !starting && (
        <p className="shell-help">
          Installed shells: {shells.join(', ') || 'None discovered'}. The saved default shell is
          used when configured. Closing a session stops its foreground work.
        </p>
      )}
      <div className="terminal-container" ref={container} aria-label="Local terminal" />
    </div>
  );
}
