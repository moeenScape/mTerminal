import { useEffect, useState, type FormEvent } from 'react';
import {
  accountPasswordLimits,
  type AccountAction,
  type AccountState,
} from '../../../../shared/accounts.js';

const displayDate = (value: string) => new Date(value).toLocaleString();

export function AccountSettings() {
  const [state, setState] = useState<AccountState>();
  const [mode, setMode] = useState<'sign-in' | 'register' | 'verify'>('sign-in');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void window.mterminal.account({ kind: 'status' }).then(
      (next) => {
        if (!cancelled) setState(next);
      },
      (cause: unknown) => {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : 'Account service unavailable.');
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  async function perform(action: AccountAction): Promise<void> {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const next = await window.mterminal.account(action);
      setState(next);
      if (action.kind === 'register' && next.status === 'signed-out') {
        setEmail(action.email.trim());
        setMode('verify');
        setMessage(
          'If this address can be registered, you’ll receive a verification code by email.',
        );
      }
      if (action.kind === 'sign-out' || next.status === 'signed-in') setMode('sign-in');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Account service unavailable.');
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const address = mode === 'verify' ? email : String(values.get('email') ?? '');
    const password = String(values.get('password') ?? '');
    const code = String(values.get('code') ?? '').trim();
    const passwordField = form.elements.namedItem('password');
    if (passwordField instanceof HTMLInputElement) passwordField.value = '';
    if (mode === 'register') void perform({ kind: 'register', email: address });
    else if (mode === 'verify') void perform({ kind: 'verify', email: address, password, code });
    else void perform({ kind: 'sign-in', email: address, password });
  }

  function changeMode(next: 'sign-in' | 'register'): void {
    setMessage('');
    setError('');
    setMode(next);
  }

  return (
    <section aria-labelledby="account-heading">
      <h2 id="account-heading">Account</h2>
      {error && <p role="alert">{error}</p>}
      {message && <p aria-live="polite">{message}</p>}
      {!state &&
        (error ? (
          <button
            className="secondary-button"
            type="button"
            disabled={busy}
            onClick={() => void perform({ kind: 'status' })}
          >
            Retry
          </button>
        ) : (
          <p>Checking account status…</p>
        ))}
      {state?.status === 'unconfigured' && (
        <p className="field-hint">Account service is unconfigured on this installation.</p>
      )}
      {state?.status === 'signed-out' && (
        <form key={mode} onSubmit={submit}>
          <fieldset className="preference-fields" disabled={busy}>
            {mode === 'verify' ? (
              <div className="setting-row">
                <label htmlFor="account-code">Verification code for {email}</label>
                <input
                  id="account-code"
                  name="code"
                  autoComplete="one-time-code"
                  spellCheck={false}
                  maxLength={50}
                  required
                />
              </div>
            ) : (
              <div className="setting-row">
                <label htmlFor="account-email">Email</label>
                <input
                  id="account-email"
                  name="email"
                  type="email"
                  defaultValue={email}
                  autoComplete="username"
                  maxLength={254}
                  required
                />
              </div>
            )}
            {mode !== 'register' && (
              <div className="setting-row">
                <label htmlFor="account-password">
                  {mode === 'verify' ? 'Create a password' : 'Password'}
                </label>
                <input
                  id="account-password"
                  name="password"
                  type="password"
                  autoComplete={mode === 'verify' ? 'new-password' : 'current-password'}
                  minLength={accountPasswordLimits.min}
                  maxLength={accountPasswordLimits.max}
                  required
                />
                {mode === 'verify' && (
                  <p className="field-hint">Use at least {accountPasswordLimits.min} characters.</p>
                )}
              </div>
            )}
            <div className="settings-actions">
              <button type="submit" className="primary-button">
                {mode === 'verify'
                  ? 'Verify and create account'
                  : mode === 'register'
                    ? 'Send verification code'
                    : 'Sign in'}
              </button>
              {mode === 'verify' && (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void perform({ kind: 'register', email })}
                >
                  Resend code
                </button>
              )}
              <button
                type="button"
                className="secondary-button"
                onClick={() => changeMode(mode === 'sign-in' ? 'register' : 'sign-in')}
              >
                {mode === 'sign-in' ? 'Create account' : 'Back to sign-in'}
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {state?.status === 'signed-in' && (
        <>
          <p>
            Signed in as <strong>{state.account.email}</strong>
          </p>
          {!state.retained && (
            <p className="field-hint">
              Sign-in is kept until mTerminal closes because secure storage is unavailable.
            </p>
          )}
          <h3>Devices</h3>
          <ul>
            {state.account.devices.map((device) => (
              <li key={device.id}>
                {device.name}
                {device.id === state.account.currentDeviceId ? ' (this device)' : ''} · Last signed
                in {displayDate(device.lastSignedInAt)}
              </li>
            ))}
          </ul>
          <h3>Active sessions</h3>
          <ul>
            {state.account.sessions.map((session) => (
              <li key={session.id}>
                {session.id === state.account.currentSessionId
                  ? 'This session'
                  : (state.account.devices.find((device) => device.id === session.deviceId)?.name ??
                    'Another device')}{' '}
                · Expires {displayDate(session.expiresAt)}
              </li>
            ))}
          </ul>
          <div className="settings-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={() => void perform({ kind: 'status' })}
            >
              Refresh
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => void perform({ kind: 'sign-out' })}
            >
              Sign out
            </button>
          </div>
        </>
      )}
    </section>
  );
}
