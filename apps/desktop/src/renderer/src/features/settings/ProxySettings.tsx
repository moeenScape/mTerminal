import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  describeProxy,
  proxyTypeLabels,
  validateProxy,
  MAX_PROXIES,
  type ProxySummary,
  type ProxyType,
} from '../../../../shared/proxies';
import { ConfirmDialog, errorMessage } from '../../components/ConfirmDialog';

interface Draft {
  id?: string;
  name: string;
  type: ProxyType;
  address: string;
  port: string;
  username: string;
  password: string;
  /** Editing: the password currently saved for this proxy. */
  passwordSaved: boolean;
  forgetPassword: boolean;
}
const defaultPorts: Record<ProxyType, string> = { socks5: '1080', socks4: '1080', http: '8080' };
const emptyDraft: Draft = {
  name: '',
  type: 'socks5',
  address: '',
  port: '1080',
  username: '',
  password: '',
  passwordSaved: false,
  forgetPassword: false,
};

/** Settings section: saved proxies that hosts can connect through. */
export function ProxySettings() {
  const [proxies, setProxies] = useState<ProxySummary[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<ProxySummary | null>(null);

  const load = useCallback(async () => {
    try {
      setProxies(await window.mterminal.listProxies());
    } catch (cause) {
      setProxies([]);
      setError(errorMessage(cause, 'Unable to load saved proxies.'));
    }
  }, []);
  useEffect(() => {
    let cancelled = false;
    window.mterminal
      .listProxies()
      .then((value) => {
        if (!cancelled) setProxies(value);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setProxies([]);
        setError(errorMessage(cause, 'Unable to load saved proxies.'));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = (patch: Partial<Draft>) =>
    setDraft((current) => (current ? { ...current, ...patch } : current));

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    setFormError('');
    try {
      const value = validateProxy({
        name: draft.name,
        type: draft.type,
        address: draft.address,
        port: Number(draft.port === '' ? NaN : draft.port),
        username: draft.username,
      });
      if (draft.password && !value.username)
        throw new Error('Enter the proxy username before saving a password.');
      setBusy(true);
      await window.mterminal.saveProxy(
        value,
        draft.type !== 'socks4' && draft.password
          ? draft.password
          : draft.forgetPassword || draft.type === 'socks4' || !value.username
            ? null
            : undefined,
        draft.id,
      );
      setDraft(null);
      await load();
    } catch (cause) {
      setFormError(errorMessage(cause, 'Unable to save the proxy.'));
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="proxies-heading">
      <h2 id="proxies-heading">Proxies</h2>
      <p className="section-description">
        For networks that block direct SSH. Choose a proxy in a host’s editor under{' '}
        <em>Connect through proxy</em>. Proxy passwords are stored in the encrypted vault.
      </p>
      {error && (
        <p className="dialog-error" role="alert">
          {error}
        </p>
      )}
      {proxies === null ? (
        <p role="status">Loading proxies…</p>
      ) : proxies.length ? (
        <ul className="proxy-list" aria-label="Saved proxies">
          {proxies.map((proxy) => (
            <li key={proxy.id} className="proxy-row">
              <div>
                <strong>{proxy.name}</strong>
                <span>
                  {describeProxy(proxy)}
                  {proxy.username
                    ? ` · ${proxy.username}${proxy.passwordSaved ? ' · password saved' : ''}`
                    : ''}
                </span>
              </div>
              <div className="settings-actions">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!!draft}
                  onClick={() => {
                    setFormError('');
                    setDraft({
                      id: proxy.id,
                      name: proxy.name,
                      type: proxy.type,
                      address: proxy.address,
                      port: String(proxy.port),
                      username: proxy.username,
                      password: '',
                      passwordSaved: proxy.passwordSaved,
                      forgetPassword: false,
                    });
                  }}
                  aria-label={`Edit ${proxy.name}`}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setDeleting(proxy)}
                  aria-label={`Delete ${proxy.name}`}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        !draft && <p className="section-description">No proxies saved.</p>
      )}
      {draft ? (
        <form className="proxy-form" onSubmit={(event) => void save(event)}>
          <h3>{draft.id ? 'Edit proxy' : 'New proxy'}</h3>
          <label>
            Name
            <input
              value={draft.name}
              maxLength={100}
              placeholder="Office proxy"
              onChange={(event) => update({ name: event.target.value })}
            />
          </label>
          <label>
            Type
            <select
              value={draft.type}
              onChange={(event) => {
                const type = event.target.value as ProxyType;
                update({
                  type,
                  ...(draft.port === defaultPorts[draft.type] ? { port: defaultPorts[type] } : {}),
                });
              }}
            >
              {(Object.keys(proxyTypeLabels) as ProxyType[]).map((type) => (
                <option key={type} value={type}>
                  {proxyTypeLabels[type]}
                </option>
              ))}
            </select>
          </label>
          <div className="proxy-endpoint">
            <label>
              Address
              <input
                value={draft.address}
                maxLength={253}
                spellCheck={false}
                placeholder="proxy.example.com"
                onChange={(event) => update({ address: event.target.value })}
                required
              />
            </label>
            <label>
              Port
              <input
                value={draft.port}
                inputMode="numeric"
                onChange={(event) => update({ port: event.target.value.replace(/\D/g, '') })}
                required
              />
            </label>
          </div>
          <label>
            {draft.type === 'socks4' ? 'User ID (optional)' : 'Username (optional)'}
            <input
              value={draft.username}
              maxLength={255}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => update({ username: event.target.value })}
            />
          </label>
          {draft.type !== 'socks4' && !!draft.username.trim() && (
            <>
              <label>
                Password
                <input
                  type="password"
                  value={draft.password}
                  maxLength={255}
                  autoComplete="off"
                  placeholder={draft.passwordSaved ? 'Saved — leave empty to keep' : ''}
                  onChange={(event) => update({ password: event.target.value })}
                />
              </label>
              {draft.passwordSaved && !draft.password && (
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={draft.forgetPassword}
                    onChange={(event) => update({ forgetPassword: event.target.checked })}
                  />
                  Forget the saved password
                </label>
              )}
            </>
          )}
          {draft.type === 'http' && (
            <p className="field-hint">
              HTTP proxies send the login with Basic authentication; the tunnel itself carries
              encrypted SSH.
            </p>
          )}
          {formError && (
            <p className="dialog-error" role="alert">
              {formError}
            </p>
          )}
          <div className="settings-actions">
            <button type="submit" className="primary-button" disabled={busy}>
              Save proxy
            </button>
            <button type="button" className="secondary-button" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="settings-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={!proxies || proxies.length >= MAX_PROXIES}
            onClick={() => {
              setFormError('');
              setDraft({ ...emptyDraft });
            }}
          >
            Add proxy
          </button>
        </div>
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete “${deleting.name}”?`}
          confirmLabel="Delete proxy"
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            await window.mterminal.deleteProxy(deleting.id);
            setDeleting(null);
            await load();
          }}
        >
          <p>
            Hosts that use this proxy will connect directly. Its saved password is removed from the
            vault.
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}
