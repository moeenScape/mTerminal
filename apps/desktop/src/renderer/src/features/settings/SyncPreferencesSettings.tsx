import { useEffect, useState } from 'react';
import type { SyncPreferenceResult, SyncPreferences } from '../../../../shared/sync-preferences.js';
import { errorMessage } from '../../components/ConfirmDialog';
import { CredentialSyncSettings } from './CredentialSyncSettings';
import { WorkspaceSyncSettings } from './WorkspaceSyncSettings';

export function SyncPreferencesSettings() {
  const [state, setState] = useState<Extract<SyncPreferenceResult, { kind: 'preferences' }>>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void window.mterminal.syncPreferences({ kind: 'status' }).then(
      (result) => {
        if (active && result.kind === 'preferences') setState(result);
      },
      (cause: unknown) => {
        if (active) setError(errorMessage(cause, 'Sync preferences could not be read.'));
      },
    );
    return () => {
      active = false;
    };
  }, []);

  async function update(category: keyof SyncPreferences, enabled: boolean) {
    setBusy(true);
    setError('');
    try {
      const result = await window.mterminal.syncPreferences({
        kind: 'set-category',
        category,
        enabled,
      });
      if (result.kind === 'preferences') setState(result);
    } catch (cause) {
      setError(errorMessage(cause, 'Sync preferences could not be saved.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h3>Sync preferences for this device</h3>
      {error && <p role="alert">{error}</p>}
      {state ? (
        <>
          <fieldset className="preference-fields" disabled={busy}>
            <label className="check-row">
              <input
                type="checkbox"
                checked={state.preferences.metadata}
                onChange={(event) => void update('metadata', event.target.checked)}
              />{' '}
              Sync workspace metadata
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={state.preferences.credentials}
                onChange={(event) => void update('credentials', event.target.checked)}
              />{' '}
              Sync saved SSH credentials
            </label>
          </fieldset>
          <WorkspaceSyncSettings
            key={String(state.preferences.metadata)}
            enabled={state.preferences.metadata}
          />
          {state.preferences.credentials && <CredentialSyncSettings owners={state.owners} />}
        </>
      ) : (
        !error && <p>Loading sync preferences…</p>
      )}
    </div>
  );
}
