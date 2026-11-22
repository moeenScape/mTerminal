import { useEffect, useState, type FormEvent } from 'react';
import {
  accountPasswordLimits,
  type AccountAction,
  type AccountState,
} from '../../../../shared/accounts.js';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { AccountProtection } from './AccountProtection';
import { WorkspaceSyncSettings } from './WorkspaceSyncSettings';

const displayDate = (value: string) => new Date(value).toLocaleString();

export function AccountSettings() {
  const [state, setState] = useState<AccountState>();
  const [mode, setMode] = useState<'sign-in' | 'register' | 'verify' | 'recover' | 'reset'>(
    'sign-in',
  );
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [setupKey, setSetupKey] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [revoking, setRevoking] = useState<{ id: string; name: string }>();

  useEffect(() => {
    let cancelled = false;
    void window.mterminal.account({ kind: 'status' }).then(
      (next) => {
        if (!cancelled && next.status !== 'mfa-enabled' && next.status !== 'mfa-setup')
          setState(next);
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

  async function perform(action: AccountAction): Promise<boolean> {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const next = await window.mterminal.account(action);
      if (next.status === 'mfa-setup') {
        setSetupKey(next.key);
        return true;
      }
      if (next.status === 'mfa-enabled') {
        setSetupKey('');
        setRecoveryCodes(next.recoveryCodes);
        setState((previous) =>
          previous?.status === 'signed-in'
            ? {
                ...previous,
                account: {
                  ...previous.account,
                  mfaEnabled: true,
                  sessions: previous.account.sessions.filter(
                    (entry) => entry.id === previous.account.currentSessionId,
                  ),
                },
              }
            : previous,
        );
        return true;
      }
      setState(next);
      if (next.status !== 'signed-in') {
        setSetupKey('');
        setRecoveryCodes([]);
      }
      if (action.kind === 'register' && next.status === 'signed-out') {
        setEmail(action.email.trim());
        setMode('verify');
        setMessage(
          'If this address can be registered, you’ll receive a verification code by email.',
        );
      }
      if (action.kind === 'recover' && next.status === 'signed-out') {
        setEmail(action.email.trim());
        setMode('reset');
        setMessage('If the address has an account, you’ll receive a password reset code by email.');
      }
      if (action.kind === 'reset' && next.status === 'signed-out') {
        setMode('sign-in');
        setMessage('Password changed. Sign in with your new password.');
      }
      if (action.kind === 'sign-out' || next.status === 'signed-in') setMode('sign-in');
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Account service unavailable.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const address =
      mode === 'verify' || mode === 'reset' ? email : String(values.get('email') ?? '');
    const password = String(values.get('password') ?? '');
    const code = String(values.get('code') ?? '').trim();
    const factor = String(values.get('factor') ?? '').trim();
    const secondFactor = factor ? { factor } : {};
    const passwordField = form.elements.namedItem('password');
    if (passwordField instanceof HTMLInputElement) passwordField.value = '';
    if (mode === 'register') void perform({ kind: 'register', email: address });
    else if (mode === 'recover') void perform({ kind: 'recover', email: address });
    else if (mode === 'verify') void perform({ kind: 'verify', email: address, password, code });
    else if (mode === 'reset')
      void perform({ kind: 'reset', email: address, password, code, ...secondFactor });
    else void perform({ kind: 'sign-in', email: address, password, ...secondFactor });
  }

  function changeMode(next: 'sign-in' | 'register' | 'recover'): void {
    setMessage('');
    setError('');
    setMode(next);
  }

  const enteringCode = mode === 'verify' || mode === 'reset';
  const requestingCode = mode === 'register' || mode === 'recover';

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
      {state?.status === 'offline' && (
        <>
          <p role="status">
            The account service is unreachable. Workspace changes can still be queued.
          </p>
          <button
            className="secondary-button"
            type="button"
            disabled={busy}
            onClick={() => void perform({ kind: 'status' })}
          >
            Retry account connection
          </button>
        </>
      )}
      {state?.status === 'signed-out' && (
        <form key={mode} onSubmit={submit}>
          <fieldset className="preference-fields" disabled={busy}>
            {enteringCode ? (
              <div className="setting-row">
                <label htmlFor="account-code">
                  {mode === 'verify' ? 'Verification' : 'Password reset'} code for {email}
                </label>
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
            {!requestingCode && (
              <div className="setting-row">
                <label htmlFor="account-password">
                  {mode === 'verify'
                    ? 'Create a password'
                    : mode === 'reset'
                      ? 'New password'
                      : 'Password'}
                </label>
                <input
                  id="account-password"
                  name="password"
                  type="password"
                  autoComplete={enteringCode ? 'new-password' : 'current-password'}
                  minLength={accountPasswordLimits.min}
                  maxLength={accountPasswordLimits.max}
                  required
                />
                {enteringCode && (
                  <p className="field-hint">Use at least {accountPasswordLimits.min} characters.</p>
                )}
              </div>
            )}
            {(mode === 'sign-in' || mode === 'reset') && (
              <div className="setting-row">
                <label htmlFor="account-factor">Authenticator or recovery code (if enabled)</label>
                <input
                  id="account-factor"
                  name="factor"
                  autoComplete="one-time-code"
                  maxLength={32}
                  pattern="(?:[0-9]{6}|[a-fA-F0-9]{32})"
                />
              </div>
            )}
            <div className="settings-actions">
              <button type="submit" className="primary-button">
                {mode === 'verify'
                  ? 'Verify and create account'
                  : mode === 'reset'
                    ? 'Reset password'
                    : mode === 'recover'
                      ? 'Send reset code'
                      : mode === 'register'
                        ? 'Send verification code'
                        : 'Sign in'}
              </button>
              {enteringCode && (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() =>
                    void perform({ kind: mode === 'verify' ? 'register' : 'recover', email })
                  }
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
              {mode === 'sign-in' && (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => changeMode('recover')}
                >
                  Forgot password
                </button>
              )}
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
          <AccountProtection
            enabled={state.account.mfaEnabled}
            busy={busy}
            setupKey={setupKey}
            recoveryCodes={recoveryCodes}
            perform={perform}
            clearSecrets={() => {
              setSetupKey('');
              setRecoveryCodes([]);
            }}
          />
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
            {state.account.sessions.map((session) => {
              const current = session.id === state.account.currentSessionId;
              const name =
                state.account.devices.find((device) => device.id === session.deviceId)?.name ??
                'Another device';
              return (
                <li key={session.id}>
                  {current ? 'This session' : name} · Expires {displayDate(session.expiresAt)}
                  {!current && (
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={busy}
                      aria-label={`Revoke session on ${name}`}
                      onClick={() => setRevoking({ id: session.id, name })}
                    >
                      Revoke
                    </button>
                  )}
                </li>
              );
            })}
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
      {(state?.status === 'signed-in' || state?.status === 'offline') && <WorkspaceSyncSettings />}
      {revoking && (
        <ConfirmDialog
          title="Revoke account session?"
          confirmLabel="Revoke session"
          danger
          onCancel={() => setRevoking(undefined)}
          onConfirm={async () => {
            const next = await window.mterminal.account({
              kind: 'revoke-session',
              sessionId: revoking.id,
            });
            if (next.status !== 'mfa-enabled' && next.status !== 'mfa-setup') setState(next);
            setRevoking(undefined);
          }}
        >
          <p>{revoking.name} will need to sign in again.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
