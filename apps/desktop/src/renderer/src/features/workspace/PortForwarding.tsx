import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  describeForward,
  forwardErrorMessages,
  isLoopback,
  validatePortForward,
  MAX_FORWARD_RULES,
  type ActiveForward,
  type ForwardKind,
  type PortForwardRule,
} from '../../../../shared/port-forwarding';
import { Icon } from '../../components/Icon';
import { ConfirmDialog, errorMessage } from '../../components/ConfirmDialog';

interface Draft {
  id?: string;
  name: string;
  kind: ForwardKind;
  bindAddress: string;
  bindPort: string;
  destinationHost: string;
  destinationPort: string;
}
const emptyDraft: Draft = {
  name: '',
  kind: 'local',
  bindAddress: '127.0.0.1',
  bindPort: '',
  destinationHost: '127.0.0.1',
  destinationPort: '',
};
const kindLabels: Record<ForwardKind, string> = {
  local: 'Local',
  remote: 'Remote',
  dynamic: 'Dynamic (SOCKS)',
};
const kindHelp: Record<ForwardKind, string> = {
  local:
    'Listen on this PC and reach a service through the server. Example: 127.0.0.1:8080 → 127.0.0.1:5432 opens the server’s database on your localhost:8080.',
  remote:
    'The server listens and sends its connections to a service reachable from this PC. Port 0 lets the server choose.',
  dynamic:
    'A SOCKS5 proxy on this PC. Point a browser or tool at it to send its traffic through the server.',
};

function toDraft(rule: PortForwardRule): Draft {
  return {
    id: rule.id,
    name: rule.name,
    kind: rule.kind,
    bindAddress: rule.bindAddress,
    bindPort: String(rule.bindPort),
    destinationHost: rule.destinationHost || '127.0.0.1',
    destinationPort: rule.destinationPort ? String(rule.destinationPort) : '',
  };
}

export function PortForwarding({
  hostId,
  sessionId,
  title,
  onClose,
}: {
  hostId: string;
  /** The connected SSH session, or null while disconnected. */
  sessionId: string | null;
  title: string;
  onClose: () => void;
}) {
  const [rules, setRules] = useState<PortForwardRule[] | null>(null);
  const [active, setActive] = useState<ActiveForward[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formError, setFormError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<PortForwardRule | null>(null);

  const loadRules = useCallback(async () => {
    try {
      setRules(await window.mterminal.listForwardRules(hostId));
    } catch (cause) {
      setRules([]);
      setError(errorMessage(cause, 'Unable to load saved forwards.'));
    }
  }, [hostId]);
  const loadState = useCallback(async () => {
    try {
      setActive(await window.mterminal.getForwardState());
    } catch {
      setActive([]);
    }
  }, []);
  useEffect(() => {
    let cancelled = false;
    window.mterminal
      .listForwardRules(hostId)
      .then((value) => {
        if (!cancelled) setRules(value);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setRules([]);
        setError(errorMessage(cause, 'Unable to load saved forwards.'));
      });
    window.mterminal
      .getForwardState()
      .then((value) => {
        if (!cancelled) setActive(value);
      })
      .catch(() => {});
    const unsubscribe = window.mterminal.onForwardsChanged(() => void loadState());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [hostId, loadState]);

  const running = (rule: PortForwardRule) =>
    active.find((item) => item.sessionId === sessionId && item.rule.id === rule.id);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    setFormError('');
    try {
      const value = validatePortForward({
        name: draft.name,
        kind: draft.kind,
        bindAddress: draft.bindAddress,
        bindPort: Number(draft.bindPort === '' ? NaN : draft.bindPort),
        destinationHost: draft.kind === 'dynamic' ? '' : draft.destinationHost,
        destinationPort:
          draft.kind === 'dynamic'
            ? 0
            : Number(draft.destinationPort === '' ? NaN : draft.destinationPort),
      });
      setBusy('save');
      await window.mterminal.saveForwardRule(hostId, value, draft.id);
      setDraft(null);
      await loadRules();
    } catch (cause) {
      setFormError(errorMessage(cause, 'Unable to save this forward.'));
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (rule: PortForwardRule) => {
    if (!sessionId) return;
    setError('');
    setBusy(rule.id);
    try {
      const current = running(rule);
      if (current && current.status !== 'failed')
        await window.mterminal.stopForward(sessionId, rule.id);
      else await window.mterminal.startForward(sessionId, rule.id);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to change this forward.'));
    } finally {
      setBusy(null);
      void loadState();
    }
  };

  const update = (patch: Partial<Draft>) =>
    setDraft((current) => (current ? { ...current, ...patch } : current));

  return (
    <section className="forward-panel" aria-label="Port forwarding">
      <header className="file-browser-header">
        <div>
          <Icon name="hosts" />
          <strong>Port forwarding</strong>
          <span>{title}</span>
        </div>
        <button type="button" className="secondary-button" onClick={onClose}>
          Back to terminal
        </button>
      </header>
      <div className="forward-body">
        {!sessionId && (
          <p className="forward-notice" role="status">
            Connect this SSH tab to start forwards. Saved rules can still be edited.
          </p>
        )}
        {error && (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        )}
        <div className="forward-toolbar">
          <p>
            Forwards run through this tab’s SSH connection and stop when it disconnects or closes.
          </p>
          <button
            type="button"
            className="primary-button"
            disabled={!rules || rules.length >= MAX_FORWARD_RULES || !!draft}
            onClick={() => {
              setFormError('');
              setDraft({ ...emptyDraft });
            }}
          >
            <Icon name="plus" /> New forward
          </button>
        </div>
        {draft && (
          <form className="forward-form" onSubmit={(event) => void save(event)}>
            <h3>{draft.id ? 'Edit forward' : 'New forward'}</h3>
            <div className="forward-kinds" role="radiogroup" aria-label="Forward type">
              {(Object.keys(kindLabels) as ForwardKind[]).map((kind) => (
                <label key={kind} data-selected={draft.kind === kind}>
                  <input
                    type="radio"
                    name="forward-kind"
                    checked={draft.kind === kind}
                    onChange={() =>
                      update({
                        kind,
                        ...(kind === 'remote'
                          ? {}
                          : { bindAddress: draft.bindAddress || '127.0.0.1' }),
                      })
                    }
                  />
                  {kindLabels[kind]}
                </label>
              ))}
            </div>
            <p className="field-hint">{kindHelp[draft.kind]}</p>
            <label>
              Name (optional)
              <input
                value={draft.name}
                maxLength={100}
                placeholder="Database"
                onChange={(event) => update({ name: event.target.value })}
              />
            </label>
            <fieldset>
              <legend>
                {draft.kind === 'remote' ? 'Listen on the server' : 'Listen on this PC'}
              </legend>
              <label>
                Address
                <input
                  value={draft.bindAddress}
                  maxLength={253}
                  spellCheck={false}
                  onChange={(event) => update({ bindAddress: event.target.value })}
                />
              </label>
              <label>
                Port
                <input
                  value={draft.bindPort}
                  inputMode="numeric"
                  placeholder={
                    draft.kind === 'dynamic'
                      ? '1080'
                      : draft.kind === 'remote'
                        ? '0 = auto'
                        : '8080'
                  }
                  onChange={(event) => update({ bindPort: event.target.value.replace(/\D/g, '') })}
                  required
                />
              </label>
            </fieldset>
            {draft.kind !== 'dynamic' && (
              <fieldset>
                <legend>
                  {draft.kind === 'local'
                    ? 'Destination (as seen from the server)'
                    : 'Destination (as seen from this PC)'}
                </legend>
                <label>
                  Host
                  <input
                    value={draft.destinationHost}
                    maxLength={253}
                    spellCheck={false}
                    onChange={(event) => update({ destinationHost: event.target.value })}
                    required
                  />
                </label>
                <label>
                  Port
                  <input
                    value={draft.destinationPort}
                    inputMode="numeric"
                    placeholder="5432"
                    onChange={(event) =>
                      update({ destinationPort: event.target.value.replace(/\D/g, '') })
                    }
                    required
                  />
                </label>
              </fieldset>
            )}
            {draft.bindAddress.trim() && !isLoopback(draft.bindAddress.trim()) && (
              <p className="forward-warning" role="note">
                {draft.kind === 'remote'
                  ? 'Other machines may reach this port on the server if its SSH configuration allows it (GatewayPorts).'
                  : 'Other devices on your network can reach this port. Use 127.0.0.1 to keep it private to this PC.'}
              </p>
            )}
            {draft.id &&
              active.some((item) => item.rule.id === draft.id && item.status !== 'failed') && (
                <p className="field-hint">
                  Saving changes stops this running forward; start it again afterwards.
                </p>
              )}
            {formError && (
              <p className="dialog-error" role="alert">
                {formError}
              </p>
            )}
            <div className="dialog-actions">
              <button type="button" className="secondary-button" onClick={() => setDraft(null)}>
                Cancel
              </button>
              <button type="submit" className="primary-button" disabled={busy === 'save'}>
                Save forward
              </button>
            </div>
          </form>
        )}
        {rules === null ? (
          <p role="status">Loading saved forwards…</p>
        ) : !rules.length && !draft ? (
          <div className="forward-empty">
            <h3>No forwards for this host yet</h3>
            <p>Create one to reach a database, web panel or other service behind the server.</p>
          </div>
        ) : (
          <ul className="forward-list" aria-label="Saved forwards">
            {rules.map((rule) => {
              const state = running(rule);
              const status = state?.status ?? 'stopped';
              const on = status === 'active' || status === 'starting';
              return (
                <li key={rule.id} className="forward-row" data-status={status}>
                  <div className="forward-info">
                    <div className="forward-title">
                      <span className="forward-kind">{kindLabels[rule.kind]}</span>
                      <strong>{rule.name || describeForward(rule)}</strong>
                    </div>
                    <span className="forward-route">{describeForward(rule, state?.boundPort)}</span>
                    {state?.status === 'failed' && state.error && (
                      <span className="forward-error">{forwardErrorMessages[state.error]}</span>
                    )}
                  </div>
                  <span className="forward-status" role="status">
                    <span className="forward-dot" aria-hidden="true" />
                    {status === 'active'
                      ? `Active · ${state!.connections} open${state!.failedConnections ? ` · ${state!.failedConnections} failed` : ''}`
                      : status === 'starting'
                        ? 'Starting…'
                        : status === 'failed'
                          ? 'Failed'
                          : 'Stopped'}
                  </span>
                  <div className="forward-actions">
                    <button
                      type="button"
                      className={on ? 'secondary-button' : 'primary-button'}
                      disabled={!sessionId || busy === rule.id || status === 'starting'}
                      onClick={() => void toggle(rule)}
                      aria-label={`${on ? 'Stop' : 'Start'} ${rule.name || describeForward(rule)}`}
                    >
                      {on ? 'Stop' : status === 'failed' ? 'Retry' : 'Start'}
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={!!draft}
                      onClick={() => {
                        setFormError('');
                        setDraft(toDraft(rule));
                      }}
                      aria-label={`Edit ${rule.name || describeForward(rule)}`}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setDeleting(rule)}
                      aria-label={`Delete ${rule.name || describeForward(rule)}`}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {deleting && (
        <ConfirmDialog
          title="Delete this forward?"
          confirmLabel="Delete forward"
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            await window.mterminal.deleteForwardRule(deleting.id);
            setDeleting(null);
            if (draft?.id === deleting.id) setDraft(null);
            await loadRules();
          }}
        >
          <p>{describeForward(deleting)}. It is stopped if running and removed from this host.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
