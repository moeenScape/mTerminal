import { useCallback, useEffect, useRef, useState } from 'react';
import { ConfirmDialog, errorMessage, useModalDialog } from '../../components/ConfirmDialog';
import {
  BATCH_CONCURRENCY,
  type BatchTarget,
  type BatchPreview,
  type BatchState,
  type BatchRow,
} from '../../../../shared/batch';
const destination = (target: BatchTarget) =>
  `${target.username}@${target.address.includes(':') ? `[${target.address}]` : target.address}:${target.port}`;
const labels: Record<BatchRow['status'], string> = {
  queued: 'Queued',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
  'timed-out': 'Timed out',
  'output-limit': 'Output limit reached',
  disconnected: 'Disconnected',
};
export function BatchCommands({ onClose }: { onClose: () => void }) {
  const ref = useModalDialog();
  const [targets, setTargets] = useState<BatchTarget[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [command, setCommand] = useState('');
  const [job, setJob] = useState<BatchState | null>(null);
  const [preview, setPreview] = useState<BatchPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const lifecycle = useRef({ active: true, generation: 0 });
  const refresh = useCallback(() => {
    const current = lifecycle.current;
    const generation = ++current.generation;
    return Promise.all([window.mterminal.listBatchTargets(), window.mterminal.getBatchState()])
      .then(([targets, state]) => {
        if (!current.active || generation !== current.generation) return;
        setTargets(targets);
        setSelected((selected) =>
          selected.filter((id) => targets.some((target) => target.sessionId === id)),
        );
        setJob(state);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (current.active && generation === current.generation) {
          setError(errorMessage(cause, 'Unable to load command destinations.'));
          setLoading(false);
        }
      });
  }, []);
  useEffect(() => {
    const current = lifecycle.current;
    current.active = true;
    void refresh();
    const unsubscribe = window.mterminal.onBatchChanged(() => void refresh());
    return () => {
      current.active = false;
      current.generation++;
      unsubscribe();
    };
  }, [refresh]);
  const running = !!job && !job.finished;
  return (
    <dialog
      ref={ref}
      className="terminal-dialog batch-dialog"
      aria-labelledby="batch-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy && !preview) onClose();
      }}
    >
      <h2 id="batch-title">Run on multiple hosts</h2>
      <p>
        Choose connected SSH hosts. Commands use separate non-interactive exec channels; include any
        required directory or environment setup.
      </p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy || running) return;
          setBusy(true);
          setError('');
          try {
            setPreview(await window.mterminal.prepareBatch({ command, sessionIds: selected }));
          } catch (cause) {
            setError(errorMessage(cause, 'Unable to prepare the command batch.'));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="batch-toolbar">
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => {
              setError('');
              void refresh();
            }}
          >
            Refresh destinations
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={busy || running || !targets.length}
            onClick={() => setSelected(targets.map((target) => target.sessionId))}
          >
            Select all connected
          </button>
        </div>
        {loading ? (
          <p role="status">Loading destinations…</p>
        ) : !targets.length ? (
          <p>Connect the SSH hosts you want to use from Hosts, then refresh destinations.</p>
        ) : (
          <fieldset disabled={busy || running} className="batch-destinations">
            <legend>Destinations</legend>
            {targets.map((target) => (
              <label key={target.sessionId}>
                <input
                  type="checkbox"
                  checked={selected.includes(target.sessionId)}
                  onChange={(event) =>
                    setSelected((selected) =>
                      event.target.checked
                        ? [...selected, target.sessionId]
                        : selected.filter((id) => id !== target.sessionId),
                    )
                  }
                />
                <span>
                  {destination(target)}
                  <small>{target.fingerprint}</small>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        <label>
          Command for selected hosts
          <textarea
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            required
            maxLength={4096}
            rows={5}
            spellCheck={false}
            autoComplete="off"
            disabled={busy || running}
            placeholder="hostname && uptime"
          />
        </label>
        <p className="field-hint">
          {selected.length} destinations selected · Up to {BATCH_CONCURRENCY} commands at once ·
          60-second timeout and 64 KiB combined output per host.
        </p>
        <button
          type="submit"
          className="primary-button"
          disabled={busy || running || !selected.length || !command.trim()}
        >
          Review batch
        </button>
      </form>
      {job && (
        <section className="batch-results" aria-label="Command batch results">
          <h3>
            {job.finished
              ? 'Batch finished'
              : job.cancelRequested
                ? 'Cancellation requested'
                : 'Batch running'}
          </h3>
          <pre className="snippet-preview">{job.command}</pre>
          <p>
            Closing this panel leaves the approved batch running. A new batch replaces these
            in-memory results.
          </p>
          {!job.finished && (
            <button
              type="button"
              className="secondary-button"
              disabled={job.cancelRequested || busy}
              onClick={async () => {
                setError('');
                try {
                  await window.mterminal.cancelBatch(job.id);
                  void refresh();
                } catch (cause) {
                  setError(errorMessage(cause, 'Unable to cancel the batch.'));
                }
              }}
            >
              Cancel batch
            </button>
          )}
          <p className="field-hint">
            Cancellation, timeouts and disconnects close exec channels; remote processes may
            continue. Commands are never retried automatically.
          </p>
          <ol>
            {job.results.map((row) => (
              <li key={row.target.sessionId}>
                <strong>{destination(row.target)}</strong>
                <p role="status">
                  {labels[row.status]}
                  {row.exitCode !== null ? ` · Exit ${row.exitCode}` : ''}
                  {row.exitSignal ? ` · Signal ${row.exitSignal}` : ''}
                </p>
                {row.status === 'failed' && row.exitCode === null && (
                  <p>No successful exit status was confirmed.</p>
                )}
                <details>
                  <summary>Output</summary>
                  <h4>Standard output</h4>
                  <pre>{row.stdout || '(empty)'}</pre>
                  <h4>Standard error</h4>
                  <pre>{row.stderr || '(empty)'}</pre>
                </details>
              </li>
            ))}
          </ol>
        </section>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="dialog-actions">
        <button type="button" disabled={busy} onClick={onClose}>
          Close panel
        </button>
      </div>
      {preview && (
        <ConfirmDialog
          title="Run command on selected hosts?"
          confirmLabel="Run batch"
          onCancel={() => setPreview(null)}
          onConfirm={async () => {
            const token = preview.token;
            setError('');
            try {
              await window.mterminal.startBatch(token);
              setPreview(null);
              void refresh();
            } catch (cause) {
              setPreview(null);
              setError(
                errorMessage(cause, 'The review expired or a destination changed. Review again.'),
              );
              void refresh();
            }
          }}
        >
          <p>
            Run exactly this command on the reviewed connections. There is no automatic retry or
            rollback.
          </p>
          <pre className="snippet-preview">{preview.command}</pre>
          <ul className="batch-review-targets">
            {preview.targets.map((target) => (
              <li key={target.sessionId}>
                <strong>{destination(target)}</strong>
                <small>{target.fingerprint}</small>
              </li>
            ))}
          </ul>
          <p>
            Review expires in 60 seconds. If a destination changes or disconnects before starting,
            the batch is refused.
          </p>
        </ConfirmDialog>
      )}
    </dialog>
  );
}
