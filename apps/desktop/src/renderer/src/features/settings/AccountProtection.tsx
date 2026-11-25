import { useState, type FormEvent } from 'react';
import { accountPasswordLimits, type AccountAction } from '../../../../shared/accounts.js';

export function AccountProtection({
  enabled,
  busy,
  setupKey,
  recoveryCodes,
  perform,
  clearSecrets,
}: {
  enabled: boolean;
  busy: boolean;
  setupKey: string;
  recoveryCodes: string[];
  perform: (action: AccountAction) => Promise<boolean>;
  clearSecrets: () => void;
}) {
  const [editing, setEditing] = useState(false);
  function close() {
    clearSecrets();
    setEditing(false);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const password = String(values.get('password') ?? '');
    const factor = String(values.get('factor') ?? '').trim();
    form.reset();
    if (setupKey) void perform({ kind: 'enable-mfa', factor });
    else if (enabled)
      void perform({ kind: 'disable-mfa', password, factor }).then((ok) => {
        if (ok) close();
      });
    else void perform({ kind: 'start-mfa', password });
  }

  return (
    <div>
      <h3>Two-factor authentication</h3>
      <p>{enabled ? 'Enabled' : 'Off'}</p>
      {recoveryCodes.length > 0 ? (
        <>
          <p>
            Save these recovery codes somewhere private. Each code works once and is shown only now.
          </p>
          <pre aria-label="Account recovery codes">{recoveryCodes.join('\n')}</pre>
          <button className="secondary-button" type="button" onClick={close}>
            Done
          </button>
        </>
      ) : editing ? (
        <form key={setupKey ? 'confirm' : 'password'} onSubmit={submit}>
          <fieldset className="preference-fields" disabled={busy}>
            {setupKey ? (
              <p>
                Add this key to a time-based entry in your authenticator app:{' '}
                <code>{setupKey}</code>
              </p>
            ) : (
              <div className="setting-row">
                <label htmlFor="account-mfa-password">Current password</label>
                <input
                  id="account-mfa-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  minLength={accountPasswordLimits.min}
                  maxLength={accountPasswordLimits.max}
                  required
                />
              </div>
            )}
            {(setupKey || enabled) && (
              <div className="setting-row">
                <label htmlFor="account-mfa-factor">
                  {setupKey ? 'Six-digit authenticator code' : 'Authenticator or recovery code'}
                </label>
                <input
                  id="account-mfa-factor"
                  name="factor"
                  autoComplete="one-time-code"
                  inputMode={setupKey ? 'numeric' : 'text'}
                  maxLength={setupKey ? 6 : 32}
                  pattern={setupKey ? '[0-9]{6}' : '(?:[0-9]{6}|[a-fA-F0-9]{32})'}
                  required
                />
              </div>
            )}
            {(setupKey || enabled) && (
              <p className="field-hint">
                Changing two-factor authentication signs out your other devices.
              </p>
            )}
            <div className="settings-actions">
              <button className="primary-button" type="submit">
                {setupKey
                  ? 'Enable authenticator'
                  : enabled
                    ? 'Disable authenticator'
                    : 'Get setup key'}
              </button>
              <button className="secondary-button" type="button" onClick={close}>
                Cancel
              </button>
            </div>
          </fieldset>
        </form>
      ) : (
        <button
          className="secondary-button"
          type="button"
          disabled={busy}
          onClick={() => setEditing(true)}
        >
          {enabled ? 'Disable authenticator' : 'Set up authenticator'}
        </button>
      )}
    </div>
  );
}
