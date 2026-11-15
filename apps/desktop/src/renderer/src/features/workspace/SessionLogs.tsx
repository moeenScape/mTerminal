import { createPortal } from 'react-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ConfirmDialog, errorMessage, useModalDialog } from '../../components/ConfirmDialog';
import { Icon } from '../../components/Icon';
import {
  logLineOffset,
  type LogRecordingState,
  type SessionLog,
  type SessionLogSummary,
} from '../../../../shared/session-logs';

type Pane = { sessionId: string; title: string };
export function SessionLogs({ panes, onActivate }: { panes: Pane[]; onActivate: () => void }) {
  const [state, setState] = useState<LogRecordingState>({
    active: null,
    starting: false,
    message: '',
  });
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true,
      version = 0;
    const refresh = () => {
      const current = ++version;
      void window.mterminal
        .getLogRecordingState()
        .then((state) => {
          if (live && current === version) setState(state);
        })
        .catch(() => {});
    };
    refresh();
    const changed = window.mterminal.onSessionLogsChanged(refresh);
    const locked = window.mterminal.onVaultLocked(() => {
      setOpen(false);
      refresh();
    });
    return () => {
      live = false;
      changed();
      locked();
    };
  }, []);
  return (
    <>
      <button
        type="button"
        className="session-new session-logs-button"
        aria-label="Session logs"
        aria-description={
          state.active ? `Recording ${state.active.title}` : state.message || undefined
        }
        title={state.message || 'Encrypted session output logs'}
        onClick={() => {
          onActivate();
          setOpen(true);
        }}
      >
        <Icon name="history" />
        <span>{state.active ? 'Recording' : state.message ? 'Logs · stopped' : 'Logs'}</span>
      </button>
      {open &&
        createPortal(
          <SessionLogsDialog panes={panes} state={state} onClose={() => setOpen(false)} />,
          document.body,
        )}
    </>
  );
}
function SessionLogsDialog({
  panes,
  state,
  onClose,
}: {
  panes: Pane[];
  state: LogRecordingState;
  onClose: () => void;
}) {
  const ref = useModalDialog();
  const [logs, setLogs] = useState<SessionLogSummary[]>([]);
  const [selected, setSelected] = useState<SessionLog | null>(null);
  const [target, setTarget] = useState('');
  const [confirmStart, setConfirmStart] = useState<Pane | null>(null);
  const [deleting, setDeleting] = useState<SessionLogSummary | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const lifecycle = useRef({ live: true, version: 0, read: 0 });
  const refresh = useCallback(() => {
    const life = lifecycle.current,
      version = ++life.version;
    life.read++;
    return window.mterminal
      .listSessionLogs()
      .then((logs) => {
        if (!life.live || version !== life.version) return;
        setLogs(logs);
        setLoading(false);
        setSelected((selected) =>
          selected && logs.some((log) => log.id === selected.id) ? selected : null,
        );
      })
      .catch((cause: unknown) => {
        if (life.live && version === life.version) {
          setLoading(false);
          setError(errorMessage(cause, 'Unable to load session logs.'));
        }
      });
  }, []);
  useEffect(() => {
    const life = lifecycle.current;
    life.live = true;
    void refresh();
    const changed = window.mterminal.onSessionLogsChanged(() => void refresh());
    return () => {
      life.live = false;
      life.version++;
      life.read++;
      changed();
    };
  }, [refresh]);
  async function read(id: string) {
    const life = lifecycle.current,
      read = ++life.read;
    setError('');
    try {
      const log = await window.mterminal.getSessionLog(id);
      if (life.live && read === life.read) setSelected(log);
    } catch (cause) {
      if (life.live && read === life.read) setError(errorMessage(cause, 'Unable to read log.'));
    }
  }
  return (
    <dialog
      ref={ref}
      className="terminal-dialog batch-dialog session-logs-dialog"
      aria-labelledby="session-logs-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <h2 id="session-logs-title">Session logs</h2>
      <p>
        Opt-in output recording in the encrypted vault. Up to four logs, 32,768 characters each;
        logs expire 30 days after creation when accessed. Existing scrollback is not captured.
      </p>
      {state.active ? (
        <section aria-label="Active session recording">
          <strong>Recording: {state.active.title}</strong>
          <p>Closing this panel keeps recording. Stop it before editing annotations.</p>
          <button
            type="button"
            className="danger-button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await window.mterminal.stopSessionLog();
                await refresh();
                if (selected) await read(selected.id);
              } catch (cause) {
                setError(errorMessage(cause, 'Unable to stop recording.'));
              } finally {
                setBusy(false);
              }
            }}
          >
            Stop recording
          </button>
        </section>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const pane = panes.find((pane) => pane.sessionId === target);
            if (pane) setConfirmStart({ ...pane });
          }}
        >
          <label>
            Terminal to record
            <select
              required
              value={target}
              disabled={busy || state.starting}
              onChange={(event) => setTarget(event.target.value)}
            >
              <option value="">Choose a connected terminal</option>
              {panes.map((pane) => (
                <option key={pane.sessionId} value={pane.sessionId}>
                  {pane.title} · {pane.sessionId.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="primary-button"
            disabled={busy || state.starting || !target || logs.length >= 4}
          >
            {state.starting ? 'Starting…' : 'Review recording'}
          </button>
        </form>
      )}
      {state.message && <p role="status">{state.message}</p>}
      <div className="batch-toolbar">
        <button
          type="button"
          onClick={() => {
            setError('');
            void refresh();
          }}
          disabled={busy}
        >
          Refresh saved logs
        </button>
      </div>
      {loading ? (
        <p role="status">Loading logs…</p>
      ) : !logs.length ? (
        <p>No saved session logs. Set up or unlock the vault to start recording.</p>
      ) : (
        <ul className="session-log-list">
          {logs.map((log) => (
            <li key={log.id}>
              <button type="button" disabled={busy} onClick={() => void read(log.id)}>
                {log.title} · {new Date(log.createdAt).toLocaleString()} · {log.characters}{' '}
                characters ·{' '}
                {state.active?.logId === log.id
                  ? 'Recording'
                  : log.reason === 'checkpoint'
                    ? 'Interrupted checkpoint'
                    : log.reason}
              </button>
              <button
                type="button"
                aria-label={`Delete log ${log.title}`}
                disabled={busy || state.starting || state.active?.logId === log.id}
                onClick={() => setDeleting(log)}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <LogDetails
          key={selected.id}
          log={selected}
          recording={state.starting || state.active?.logId === selected.id}
          onSaved={() => {
            void refresh();
            void read(selected.id);
          }}
        />
      )}
      {error && <p role="alert">{error}</p>}
      <div className="dialog-actions">
        <button type="button" disabled={busy} onClick={onClose}>
          Close panel
        </button>
      </div>
      {confirmStart && (
        <ConfirmDialog
          title="Record this terminal's output?"
          confirmLabel="Start recording"
          onCancel={() => setConfirmStart(null)}
          onConfirm={async () => {
            const pane = confirmStart;
            await window.mterminal.startSessionLog(pane.sessionId, pane.title);
            setConfirmStart(null);
            await refresh();
          }}
        >
          <p>
            Record output from <strong>{confirmStart.title}</strong> from this point onward. Output
            can include passwords, tokens, private files and echoed input. Secrets are not
            automatically redacted. Checkpoints are encrypted, but can be read while the vault is
            unlocked.
          </p>
          <p>
            One recording at a time. It stops on disconnect, reload, vault lock, window close or the
            character limit. Crash recovery retains only the last successful checkpoint (normally
            within two seconds); it never resumes automatically.
          </p>
        </ConfirmDialog>
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete log “${deleting.title}”?`}
          confirmLabel="Delete log"
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            await window.mterminal.deleteSessionLog(deleting.id);
            setDeleting(null);
            await refresh();
          }}
        >
          <p>
            Remove this saved output and all its notes/bookmarks. Copies in separately retained
            backups or vault recovery folders are not removed.
          </p>
        </ConfirmDialog>
      )}
    </dialog>
  );
}
function LogDetails({
  log,
  recording,
  onSaved,
}: {
  log: SessionLog;
  recording: boolean;
  onSaved: () => void;
}) {
  const [notes, setNotes] = useState(log.notes);
  const [bookmarks, setBookmarks] = useState(log.bookmarks);
  const [line, setLine] = useState(1);
  const [comment, setComment] = useState('');
  const [mark, setMark] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const highlighted = useRef<HTMLElement>(null);
  useEffect(() => {
    highlighted.current?.scrollIntoView({ block: 'center' });
  }, [mark]);
  const end = mark === null ? -1 : log.text.indexOf('\n', mark);
  return (
    <section className="session-log-detail" aria-label="Saved session log">
      <h3>{log.title}</h3>
      <p>
        Plain output transcript; this is not terminal replay. Refresh/read again for a newer active
        checkpoint.
      </p>
      <pre aria-label="Recorded output">
        {mark === null ? (
          log.text || '(empty)'
        ) : (
          <>
            {log.text.slice(0, mark)}
            <mark ref={highlighted}>{log.text.slice(mark, end < 0 ? undefined : end) || ' '}</mark>
            {end < 0 ? '' : log.text.slice(end)}
          </>
        )}
      </pre>
      <fieldset disabled={recording || busy}>
        <legend>Notes and bookmarks</legend>
        <label>
          Log notes
          <input value={notes} maxLength={512} onChange={(event) => setNotes(event.target.value)} />
        </label>
        <label>
          Bookmark line
          <input
            type="number"
            min={1}
            max={log.text.split('\n').length}
            value={line}
            onChange={(event) => setLine(Number(event.target.value))}
          />
        </label>
        <label>
          Bookmark comment
          <input
            value={comment}
            maxLength={256}
            onChange={(event) => setComment(event.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={bookmarks.length >= 20}
          onClick={() => {
            try {
              const offset = logLineOffset(log.text, line);
              setBookmarks([...bookmarks, { id: crypto.randomUUID(), offset, comment }]);
              setComment('');
              setError('');
            } catch (cause) {
              setError(errorMessage(cause, 'Choose a valid line.'));
            }
          }}
        >
          Add bookmark
        </button>
        <ul>
          {bookmarks.map((bookmark) => (
            <li key={bookmark.id}>
              <button type="button" onClick={() => setMark(bookmark.offset)}>
                Line {log.text.slice(0, bookmark.offset).split('\n').length}:{' '}
                {bookmark.comment || '(no comment)'}
              </button>
              <button
                type="button"
                aria-label={`Remove bookmark at line ${log.text.slice(0, bookmark.offset).split('\n').length}`}
                onClick={() => setBookmarks(bookmarks.filter((item) => item.id !== bookmark.id))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await window.mterminal.annotateSessionLog(log.id, { notes, bookmarks });
              onSaved();
            } catch (cause) {
              setError(errorMessage(cause, 'Unable to save annotations.'));
            } finally {
              setBusy(false);
            }
          }}
        >
          Save annotations
        </button>
      </fieldset>
      <p>
        {recording && 'Stop this recording before annotating. '}
        Unsaved annotations are discarded when switching logs or closing the panel.
      </p>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
