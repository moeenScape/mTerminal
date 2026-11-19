import { useEffect, useState } from 'react';
import { resolveHost } from '../../../../shared/hosts';
import { sshStateMessages, type SshConnectionState } from '../../../../shared/terminal';
import { Icon } from '../../components/Icon';

export interface ConnectionLog {
  at: number;
  text: string;
}

/** The three steps on the progress bar and the connection states each one covers. */
const steps: {
  label: string;
  states: (SshConnectionState | 'lookup')[];
  icon: 'hosts' | 'lock' | 'terminal';
}[] = [
  { label: 'Connect', states: ['lookup', 'jumping', 'connecting', 'verifying'], icon: 'hosts' },
  { label: 'Authenticate', states: ['authenticating'], icon: 'lock' },
  { label: 'Open shell', states: ['opening-shell', 'connected'], icon: 'terminal' },
];

/**
 * Full-pane connection screen shown while an SSH session starts, as in Termius: host,
 * a three-step progress bar, the current step, logs, and Cancel or Retry.
 */
export function ConnectionProgress({
  hostId,
  title,
  state,
  error,
  logs,
  onCancel,
  onRetry,
  onClose,
}: {
  hostId: string;
  title: string;
  state: SshConnectionState | 'lookup';
  /** Set when the attempt failed; the screen then offers Retry. */
  error: string;
  logs: ConnectionLog[];
  onCancel: () => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  const [target, setTarget] = useState('');
  const [showLogs, setShowLogs] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void Promise.all([window.mterminal.listHosts(), window.mterminal.listHostGroups()])
      .then(([hosts, groups]) => {
        const host = hosts.find((item) => item.id === hostId);
        if (!host || cancelled) return;
        const resolved = resolveHost(host, groups);
        const user = resolved.username ? `${resolved.username}@` : '';
        setTarget(`SSH ${user}${resolved.address}:${resolved.port}`);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [hostId]);

  const current = steps.findIndex((step) => step.states.includes(state));
  const message =
    error || (state === 'lookup' ? 'Looking for saved credentials…' : sshStateMessages[state]);
  return (
    <section className="connection-progress" aria-label={`Connecting to ${title}`}>
      <div className="connection-card">
        <header>
          <span className="connection-badge" aria-hidden="true">
            <Icon name="hosts" />
          </span>
          <div>
            <h2>{title}</h2>
            {target && <p>{target}</p>}
          </div>
          <button
            type="button"
            className="secondary-button"
            aria-expanded={showLogs}
            onClick={() => setShowLogs((value) => !value)}
          >
            {showLogs ? 'Hide logs' : 'Show logs'}
          </button>
        </header>
        <ol className="connection-steps" aria-label="Connection steps">
          {steps.map((step, index) => {
            const status =
              error && index === current
                ? 'failed'
                : index < current
                  ? 'done'
                  : index === current
                    ? 'active'
                    : 'pending';
            return (
              <li
                key={step.label}
                data-status={status}
                aria-current={index === current ? 'step' : undefined}
              >
                <span className="connection-step-dot" aria-hidden="true">
                  <Icon name={status === 'failed' ? 'close' : step.icon} />
                </span>
                <span className="connection-step-label">{step.label}</span>
              </li>
            );
          })}
        </ol>
        <p
          className={error ? 'connection-message dialog-error' : 'connection-message'}
          // The terminal bar already announces progress; only failures need an alert.
          role={error ? 'alert' : undefined}
        >
          {message}
        </p>
        {showLogs && (
          <ol className="connection-logs" aria-label="Connection log">
            {logs.map((log, index) => (
              <li key={index}>
                <time>{new Date(log.at).toLocaleTimeString()}</time> {log.text}
              </li>
            ))}
          </ol>
        )}
        <div className="connection-actions">
          {error ? (
            <>
              <button type="button" className="secondary-button" onClick={onClose}>
                Close
              </button>
              <button type="button" className="primary-button" onClick={onRetry}>
                Retry
              </button>
            </>
          ) : (
            <button type="button" className="secondary-button" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
