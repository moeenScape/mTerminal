import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ConfirmDialog, errorMessage } from '../../components/ConfirmDialog';
import {
  accountErrors,
  type SyncQueueState,
  type WorkspaceSyncAction,
  type WorkspaceSyncResult,
} from '../../../../shared/workspace-sync.js';
import { WorkspaceSyncReview } from './WorkspaceSyncReview';

export function WorkspaceSyncSettings() {
  const keyField = useRef<HTMLInputElement>(null);
  const [generatedKey, setGeneratedKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [queue, setQueue] = useState<SyncQueueState>({ status: 'idle' });
  const [discarding, setDiscarding] = useState(false);
  const [review, setReview] = useState<Extract<WorkspaceSyncResult, { kind: 'review' }>>();

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void window.mterminal.syncWorkspace({ kind: 'queue-status' }).then(
        (result) => {
          if (active && result.kind === 'queue-status') setQueue(result.queue);
        },
        (cause: unknown) => {
          if (active) setError(errorMessage(cause, 'Could not read the publication queue.'));
        },
      );
    };
    const unsubscribe = window.mterminal.onWorkspaceSyncQueueChanged(refresh);
    refresh();
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  async function perform(action: WorkspaceSyncAction) {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const result = await window.mterminal.syncWorkspace(action);
      if (result.kind === 'review') {
        setReview(result);
      } else if (result.kind === 'review-applied') {
        if (keyField.current) keyField.current.value = '';
        setGeneratedKey('');
        setReview(undefined);
        setMessage(
          `${result.count} selected ${result.count === 1 ? 'change applied' : 'changes applied'} to ${result.target === 'cloud' ? 'the cloud copy' : 'this workspace'}.`,
        );
      } else if (result.kind === 'generated') {
        setGeneratedKey(result.key);
        if (keyField.current) keyField.current.value = result.key;
      } else if (result.kind === 'queue-status') {
        setQueue(result.queue);
        setGeneratedKey('');
        if (keyField.current) keyField.current.value = '';
      } else {
        if (result.kind === 'published') setQueue({ status: 'idle' });
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
      if (action.kind === 'apply-review') setReview(undefined);
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
    if (kind !== 'publish' && kind !== 'merge' && kind !== 'retry-publication' && kind !== 'review')
      return;
    setReview(undefined);
    void perform({ kind, key: keyField.current?.value.trim() ?? '' });
  }

  return (
    <div>
      <h3>Encrypted workspace sync</h3>
      <p>
        Publish or merge additions. To update or delete synced records, review the differences
        first.
      </p>
      {queue.status === 'retrying' && (
        <p role="status">Publication is queued. mTerminal retries while it is open.</p>
      )}
      {queue.status === 'needs-key' && (
        <p role="status">A publication is queued. Enter your sync key to retry.</p>
      )}
      {queue.status === 'blocked' && (
        <p role="alert">Publication is still queued. {accountErrors[queue.code]}</p>
      )}
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
            <button className="secondary-button" type="submit" value="review">
              Review differences
            </button>
            {queue.status !== 'idle' && (
              <>
                <button className="secondary-button" type="submit" value="retry-publication">
                  Retry queued publication
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setDiscarding(true)}
                >
                  Discard queued publication
                </button>
              </>
            )}
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
      {review && (
        <WorkspaceSyncReview
          key={review.reviewId}
          review={review}
          busy={busy}
          close={() => setReview(undefined)}
          apply={(target, records) =>
            perform({
              kind: 'apply-review',
              target,
              records,
              reviewId: review.reviewId,
              key: keyField.current?.value.trim() ?? '',
            })
          }
        />
      )}
      {discarding && (
        <ConfirmDialog
          title="Discard queued publication?"
          confirmLabel="Discard publication"
          danger
          onCancel={() => setDiscarding(false)}
          onConfirm={async () => {
            await window.mterminal.syncWorkspace({ kind: 'discard-publication' });
            setQueue({ status: 'idle' });
            setDiscarding(false);
            setError('');
            setMessage('Queued publication discarded. Local workspace records were kept.');
          }}
        >
          <p>
            This removes the saved publication from this device. Your local workspace records are
            kept.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
