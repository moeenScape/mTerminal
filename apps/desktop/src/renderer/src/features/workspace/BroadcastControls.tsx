import { useCallback, useEffect, useRef, useState } from 'react';
import { ConfirmDialog, errorMessage, useModalDialog } from '../../components/ConfirmDialog';
import {
  isBroadcastStopShortcut,
  type BroadcastAction,
  type BroadcastMode,
  type BroadcastState,
} from '../../../../shared/broadcast';
import type { BatchTarget } from '../../../../shared/batch';

const destination = (target: BatchTarget) =>
  `${target.username}@${target.address.includes(':') ? `[${target.address}]` : target.address}:${target.port} · ${target.sessionId.slice(0, 8)}`;

function BroadcastSetup({
  onStart,
  onClose,
  paneTitles,
}: {
  onStart: (targets: BatchTarget[]) => Promise<void>;
  onClose: () => void;
  paneTitles: Record<string, string>;
}) {
  const ref = useModalDialog();
  const [targets, setTargets] = useState<BatchTarget[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(
    () =>
      window.mterminal
        .listBroadcastTargets()
        .then((targets) => {
          setTargets(targets);
          setSelected([]);
          setLoading(false);
        })
        .catch((cause: unknown) => {
          setError(errorMessage(cause, 'Unable to load recipients.'));
          setLoading(false);
        }),
    [],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return (
    <dialog
      ref={ref}
      className="terminal-dialog batch-dialog"
      aria-labelledby="broadcast-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2 id="broadcast-title">Broadcast input</h2>
      <p>
        Select connected SSH sessions. Only the broadcast input bar sends to this list; typing in
        terminal panes stays local to that pane.
      </p>
      <p>
        Check that each session is at the intended prompt. Input goes to its current foreground
        program, including password prompts. Starting sends nothing.
      </p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy || !selected.length) return;
          setBusy(true);
          setError('');
          try {
            await onStart(targets.filter((target) => selected.includes(target.sessionId)));
          } catch (cause) {
            setError(errorMessage(cause, 'Unable to start broadcast.'));
          } finally {
            setBusy(false);
          }
        }}
      >
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => {
            setError('');
            void refresh();
          }}
        >
          Refresh recipients
        </button>
        {loading ? (
          <p role="status">Loading recipients…</p>
        ) : !targets.length ? (
          <p>Connect SSH sessions from Hosts, then refresh recipients.</p>
        ) : (
          <fieldset className="batch-destinations" disabled={busy}>
            <legend>Review recipients</legend>
            {targets.map((target) => (
              <label key={target.sessionId}>
                <input
                  type="checkbox"
                  checked={selected.includes(target.sessionId)}
                  onChange={(event) =>
                    setSelected((ids) =>
                      event.target.checked
                        ? [...ids, target.sessionId]
                        : ids.filter((id) => id !== target.sessionId),
                    )
                  }
                />
                <span>
                  {paneTitles[target.sessionId] || 'SSH session'}
                  <small>{destination(target)}</small>
                  <small>{target.fingerprint}</small>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary-button" disabled={busy || !selected.length}>
            {busy ? 'Starting…' : `Start broadcast (${selected.length})`}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function BroadcastControls({
  active,
  setupOpen,
  onCloseSetup,
  paneTitles,
}: {
  active: boolean;
  setupOpen: boolean;
  onCloseSetup: () => void;
  paneTitles: Record<string, string>;
}) {
  const [state, setState] = useState<BroadcastState>({ mode: null, message: '' });
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<{ mode: BroadcastMode; text: string } | null>(null);
  const [sending, setSending] = useState(false);
  const lifecycle = useRef({
    mounted: true,
    generation: 0,
    mode: null as BroadcastMode | null,
    starting: false,
    sending: false,
  });
  const refresh = useCallback(() => {
    const current = lifecycle.current;
    const generation = ++current.generation;
    return window.mterminal
      .getBroadcastState()
      .then((state) => {
        if (!current.mounted || generation !== current.generation) return;
        current.mode = state.mode;
        setState(state);
        if (!state.mode) {
          setDraft('');
          setPreview(null);
        }
      })
      .catch((cause: unknown) => {
        if (current.mounted && generation === current.generation)
          setError(errorMessage(cause, 'Unable to read broadcast state.'));
      });
  }, []);
  const stop = useCallback(() => {
    const current = lifecycle.current;
    current.generation++;
    current.mode = null;
    current.starting = false;
    setState({ mode: null, message: 'Broadcast stopped.' });
    setDraft('');
    setPreview(null);
    return window.mterminal.stopBroadcast().catch((cause: unknown) => {
      if (current.mounted) setError(errorMessage(cause, 'Unable to stop broadcast.'));
    });
  }, []);
  useEffect(() => {
    const current = lifecycle.current;
    current.mounted = true;
    void refresh();
    const unsubscribe = window.mterminal.onBroadcastChanged(() => void refresh());
    const locked = window.mterminal.onVaultLocked(() => {
      void stop();
      onCloseSetup();
    });
    const key = (event: KeyboardEvent) => {
      if ((current.mode || current.starting) && isBroadcastStopShortcut(event)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        void stop();
        onCloseSetup();
      }
    };
    window.addEventListener('keydown', key, true);
    return () => {
      current.mounted = false;
      current.generation++;
      unsubscribe();
      locked();
      window.removeEventListener('keydown', key, true);
      void window.mterminal.stopBroadcast().catch(() => undefined);
    };
  }, [refresh, stop, onCloseSetup]);
  useEffect(() => {
    if (!active) {
      if (lifecycle.current.mode || lifecycle.current.starting) void stop();
      onCloseSetup();
    }
  }, [active, stop, onCloseSetup]);
  async function start(targets: BatchTarget[]) {
    const current = lifecycle.current;
    if (current.starting || current.mode) return;
    current.starting = true;
    const generation = ++current.generation;
    try {
      const next = await window.mterminal.startBroadcast(targets);
      // A stop or disconnect notification invalidates a pending start response.
      if (!current.mounted || generation !== current.generation) return;
      current.mode = next.mode;
      setState(next);
      setError('');
      setDraft('');
    } catch (cause) {
      if (current.mounted) setError(errorMessage(cause, 'Unable to start broadcast.'));
    } finally {
      current.starting = false;
      onCloseSetup();
      void refresh();
    }
  }
  async function send(modeId: string, action: BroadcastAction) {
    const current = lifecycle.current;
    if (current.sending || current.mode?.id !== modeId) return;
    current.sending = true;
    setSending(true);
    setError('');
    try {
      await window.mterminal.sendBroadcast(modeId, action);
      if (!current.mounted || current.mode?.id !== modeId) return;
      if (action.kind === 'line') setDraft((draft) => (draft === action.text ? '' : draft));
      setPreview(null);
    } catch (cause) {
      if (current.mounted) {
        setError(errorMessage(cause, 'Broadcast input failed.'));
        void refresh();
      }
    } finally {
      current.sending = false;
      if (current.mounted) setSending(false);
    }
  }
  function submit() {
    const mode = lifecycle.current.mode;
    if (!mode || !draft.trim() || sending) return;
    if (/[\r\n]/u.test(draft)) setPreview({ mode, text: draft });
    else void send(mode.id, { kind: 'line', text: draft });
  }
  return (
    <>
      {state.mode && (
        <section className="broadcast-bar" aria-label="Active broadcast input">
          <div className="broadcast-heading">
            <strong>Broadcast ON · {state.mode.targets.length} recipients</strong>
            <button type="button" className="danger-button" onClick={() => void stop()}>
              Stop broadcast
            </button>
          </div>
          <ul>
            {state.mode.targets.map((target) => (
              <li key={target.sessionId}>
                {paneTitles[target.sessionId] || 'SSH session'} · {destination(target)}
              </li>
            ))}
          </ul>
          <label>
            Broadcast text
            <textarea
              rows={2}
              maxLength={4096}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  void stop();
                } else if (
                  event.key === 'Enter' &&
                  !event.shiftKey &&
                  !event.ctrlKey &&
                  !event.metaKey &&
                  !event.altKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  submit();
                }
              }}
            />
          </label>
          <div className="batch-toolbar">
            <button
              type="button"
              className="primary-button"
              disabled={sending || !draft.trim()}
              onClick={submit}
            >
              Send to recipients
            </button>
            <button
              type="button"
              disabled={sending}
              onClick={() => void send(state.mode!.id, { kind: 'enter' })}
            >
              Enter all
            </button>
            <button
              type="button"
              disabled={sending}
              onClick={() => void send(state.mode!.id, { kind: 'interrupt' })}
            >
              Interrupt all (Ctrl+C)
            </button>
          </div>
          <p className="field-hint">
            Enter sends · Shift+Enter adds a line · Escape here or Ctrl+Shift+B / ⌘+Shift+B stops.
            Ordinary pane input stays in that pane. Already-sent input cannot be undone.
          </p>
        </section>
      )}
      {!state.mode && state.message && (
        <p className="broadcast-status" role="status">
          {state.message}
        </p>
      )}
      {error && (
        <p className="broadcast-status" role="alert">
          {error}
        </p>
      )}
      {active && setupOpen && !state.mode && (
        <BroadcastSetup
          paneTitles={paneTitles}
          onStart={start}
          onClose={() => {
            void stop();
            onCloseSetup();
          }}
        />
      )}
      {active && setupOpen && state.mode && (
        <ConfirmDialog
          title="Broadcast is already active"
          confirmLabel="Stop broadcast"
          onConfirm={async () => {
            await stop();
            onCloseSetup();
          }}
          onCancel={onCloseSetup}
        >
          <p>Stop the current broadcast before choosing different recipients.</p>
        </ConfirmDialog>
      )}
      {preview && (
        <ConfirmDialog
          title="Send multiple lines to all recipients?"
          confirmLabel="Send lines"
          onCancel={() => setPreview(null)}
          onConfirm={() => send(preview.mode.id, { kind: 'line', text: preview.text })}
        >
          <p>
            Review the exact text and recipients. Lines may execute immediately in each session's
            current program.
          </p>
          <pre className="snippet-preview">{preview.text}</pre>
          <ul>
            {preview.mode.targets.map((target) => (
              <li key={target.sessionId}>{destination(target)}</li>
            ))}
          </ul>
        </ConfirmDialog>
      )}
    </>
  );
}
