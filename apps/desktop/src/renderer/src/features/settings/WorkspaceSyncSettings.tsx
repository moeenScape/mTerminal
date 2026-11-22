import { useRef, useState, type FormEvent } from 'react';
import { errorMessage } from '../../components/ConfirmDialog';
import type { WorkspaceSyncAction } from '../../../../shared/workspace-sync.js';

export function WorkspaceSyncSettings() {
  const keyField = useRef<HTMLInputElement>(null);
  const [generatedKey, setGeneratedKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function perform(action: WorkspaceSyncAction) {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const result = await window.mterminal.syncWorkspace(action);
      if (result.kind === 'generated') {
        setGeneratedKey(result.key);
        if (keyField.current) keyField.current.value = result.key;
      } else {
        setGeneratedKey('');
        if (keyField.current) keyField.current.value = '';
        const actionText =
          result.kind === 'published'
            ? 'published to the encrypted copy'
            : 'added to this workspace';
        setMessage(
          `${result.count} ${result.count === 1 ? 'record' : 'records'} ${actionText}. Cloud revision ${result.revision}.`,
        );
      }
    } catch (cause) {
      setError(errorMessage(cause, 'Workspace sync is unavailable. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    if (!(submitter instanceof HTMLButtonElement)) return;
    const kind = submitter.value;
    if (kind !== 'publish' && kind !== 'merge') return;
    void perform({ kind, key: keyField.current?.value.trim() ?? '' });
  }

  return (
    <div>
      <h3>Encrypted workspace sync</h3>
      <p>Sync adds hosts, groups, and identity profiles. Existing records stay in place.</p>
      <form onSubmit={submit}>
        <fieldset className="preference-fields" disabled={busy}>
          <div className="setting-row">
            <label htmlFor="workspace-sync-key">Workspace sync key</label>
            <input
              ref={keyField}
              id="workspace-sync-key"
              type="password"
              maxLength={61}
              autoComplete="off"
              spellCheck={false}
              required
            />
          </div>
          <div className="settings-actions">
            <button className="primary-button" type="submit" value="publish">
              Publish local records
            </button>
            <button className="secondary-button" type="submit" value="merge">
              Merge cloud records
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={!!generatedKey}
              onClick={() => void perform({ kind: 'generate-key' })}
            >
              Generate first sync key
            </button>
          </div>
          {generatedKey && (
            <>
              <p>
                Save this key somewhere private before publishing. You’ll need it on other devices.
              </p>
              <p>
                <code>{generatedKey}</code>
              </p>
              <div className="settings-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => {
                    void window.mterminal.writeClipboardText(generatedKey).then(
                      () => setMessage('Sync key copied.'),
                      () => setError('Could not copy the sync key.'),
                    );
                  }}
                >
                  Copy key
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
