import { useRef, useState, type FormEvent } from 'react';
import type {
  CredentialKind,
  CredentialOwnerOption,
  SyncPreferenceAction,
} from '../../../../shared/sync-preferences.js';
import { errorMessage } from '../../components/ConfirmDialog';

const ownerKey = (owner: CredentialOwnerOption) => `${owner.type}:${owner.id}`;

export function CredentialSyncSettings({ owners }: { owners: CredentialOwnerOption[] }) {
  const [selected, setSelected] = useState('');
  const [kind, setKind] = useState<CredentialKind>('password');
  const [generatedKey, setGeneratedKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const keyInput = useRef<HTMLInputElement>(null);
  const owner = owners.find((item) => ownerKey(item) === selected) ?? owners[0];
  const credential = owner?.type === 'host' ? 'password' : kind;

  async function perform(action: SyncPreferenceAction) {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const result = await window.mterminal.syncPreferences(action);
      if (result.kind === 'credential-key') {
        setGeneratedKey(result.key);
        if (keyInput.current) keyInput.current.value = result.key;
      } else if (result.kind === 'credential-complete') {
        if (keyInput.current) keyInput.current.value = '';
        setGeneratedKey('');
        setMessage(
          result.operation === 'publish'
            ? 'Credential published to the encrypted cloud copy.'
            : result.operation === 'restore'
              ? 'Credential restored to the local SSH vault.'
              : 'Encrypted cloud credential removed.',
        );
      }
    } catch (cause) {
      setError(errorMessage(cause, 'Credential sync could not be completed.'));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const button = (event.nativeEvent as SubmitEvent).submitter;
    if (!owner || !(button instanceof HTMLButtonElement)) return;
    const operation = button.value;
    if (
      operation !== 'credential-publish' &&
      operation !== 'credential-restore' &&
      operation !== 'credential-remove'
    )
      return;
    void perform({
      kind: operation,
      ownerId: owner.id,
      ownerType: owner.type,
      credential,
      key: keyInput.current?.value.trim() ?? '',
    });
  }

  return (
    <div role="region" aria-label="Encrypted credential sync">
      <h3>Encrypted credential sync</h3>
      <p>
        Unlock the SSH vault to publish or restore one credential. The matching profile must exist
        on this device.
      </p>
      <form onSubmit={submit}>
        <fieldset className="preference-fields" disabled={busy}>
          <div className="setting-row">
            <label htmlFor="credential-sync-owner">Credential profile</label>
            <select
              id="credential-sync-owner"
              value={owner ? ownerKey(owner) : ''}
              onChange={(event) => setSelected(event.target.value)}
            >
              {!owner && <option value="">No saved profiles</option>}
              {owners.map((item) => (
                <option key={ownerKey(item)} value={ownerKey(item)}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          <div className="setting-row">
            <label htmlFor="credential-sync-kind">Credential type</label>
            <select
              id="credential-sync-kind"
              value={credential}
              disabled={owner?.type !== 'identity'}
              onChange={(event) => setKind(event.target.value === 'key' ? 'key' : 'password')}
            >
              <option value="password">Saved SSH password</option>
              {owner?.type === 'identity' && <option value="key">Managed private key</option>}
            </select>
          </div>
          <div className="setting-row">
            <label htmlFor="credential-sync-key">Credential sync key</label>
            <input
              id="credential-sync-key"
              ref={keyInput}
              type="password"
              autoComplete="off"
              spellCheck={false}
              maxLength={61}
              required
            />
          </div>
          <div className="settings-actions">
            <button
              className="primary-button"
              type="submit"
              value="credential-publish"
              disabled={!owner}
            >
              Publish credential
            </button>
            <button
              className="secondary-button"
              type="submit"
              value="credential-restore"
              disabled={!owner}
            >
              Restore credential
            </button>
            <button
              className="secondary-button"
              type="submit"
              value="credential-remove"
              disabled={!owner}
            >
              Remove cloud credential
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={!!generatedKey}
              onClick={() => void perform({ kind: 'credential-key' })}
            >
              Generate first credential sync key
            </button>
          </div>
          {generatedKey && (
            <>
              <p>Save this key privately before publishing a credential.</p>
              <p>
                <code>{generatedKey}</code>
              </p>
              <div className="settings-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => {
                    void window.mterminal.writeClipboardText(generatedKey).then(
                      () => setMessage('Credential sync key copied.'),
                      () => setError('Could not copy the key.'),
                    );
                  }}
                >
                  Copy credential sync key
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setGeneratedKey('')}
                >
                  Hide key
                </button>
              </div>
            </>
          )}
          {message && <p role="status">{message}</p>}
          {error && <p role="alert">{error}</p>}
        </fieldset>
      </form>
    </div>
  );
}
