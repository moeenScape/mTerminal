import { useEffect, useId, useState } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { fileErrorMessages } from '../../../../shared/files';
import type { RemoteEditState } from '../../../../shared/remote-edit';

export function useRemoteEdit() {
  const [edit, setEdit] = useState<RemoteEditState | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let mounted = true;
    let version = 0;
    const refresh = () => {
      const request = ++version;
      void window.mterminal
        .getRemoteEdit()
        .then((value) => {
          if (!mounted || request !== version) return;
          setEdit(value);
          setReady(true);
          setError('');
        })
        .catch(() => {
          if (mounted) setError('Unable to load remote editing. Reopen Files to retry.');
        });
    };
    const off = window.mterminal.onRemoteEditChanged(refresh);
    refresh();
    return () => {
      mounted = false;
      off();
    };
  }, []);
  return { edit, ready, error };
}
export function RemoteEditorPanel({
  edit,
  error,
}: {
  edit: RemoteEditState | null;
  error: string;
}) {
  const contentId = useId();
  const [expanded, setExpanded] = useState(false);
  const needsAttention = !!edit && (edit.changed || !!edit.error || edit.phase !== 'ready');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [discarding, setDiscarding] = useState(false);
  const perform = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setNotice('');
    try {
      await action();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'The remote editor action failed.');
    } finally {
      setBusy(false);
    }
  };
  const uploading = edit?.phase === 'uploading' || edit?.phase === 'conflict';
  const canUpload =
    edit &&
    edit.hasCopy &&
    edit.connected &&
    edit.changed &&
    !uploading &&
    edit.phase !== 'downloading' &&
    edit.phase !== 'uncertain' &&
    !edit.partialPath &&
    !(edit.backupPath && edit.phase === 'failed') &&
    edit.error !== 'editor-copy-unavailable' &&
    edit.error !== 'editor-text-only';
  const open = expanded || needsAttention || !!error || !!notice;
  if (!edit && !error && !notice) return null;
  return (
    <section className="remote-editor" aria-label="Remote editor">
      <header>
        <button
          type="button"
          className="file-panel-toggle"
          aria-label={open ? 'Hide editor details' : 'Show editor details'}
          aria-expanded={open}
          aria-controls={contentId}
          disabled={needsAttention || !!error || !!notice}
          onClick={() => setExpanded((value) => !value)}
        >
          <span aria-hidden="true">{open ? '▾' : '▸'}</span>
          <strong>Remote editor</strong>
        </button>
        {edit && (
          <span role="status">
            {edit.phase} · {edit.connected ? 'SSH connected' : 'SSH disconnected'} ·{' '}
            {edit.changed ? 'Saved changes pending' : 'No pending saved changes'}
          </span>
        )}
      </header>
      {(error || notice) && <p role="alert">{error || notice}</p>}
      <div id={contentId} hidden={!open}>
        {!edit ? (
          <p>Edit one remote UTF-8 text file at a time, up to 1 MiB, using its Actions menu.</p>
        ) : (
          <>
            <p>
              {edit.title} ·{' '}
              <code>
                {edit.remoteDirectory}/{edit.name}
              </code>
            </p>
            <p>
              Working copy: <code>{edit.localPath || 'Preparing private folder…'}</code>
            </p>
            {edit.error && (
              <p className="file-error" role="alert">
                {fileErrorMessages[edit.error]}
              </p>
            )}
            {edit.phase === 'conflict' && (
              <p>
                Resolve the destination conflict in the transfer queue. Your saved local changes are
                kept.
              </p>
            )}
            {edit.backupPath && (
              <p>
                Last backup/recovery path: <code>{edit.backupPath}</code>
              </p>
            )}
            {edit.partialPath && (
              <p className="file-error">
                Inspect retained temporary data: <code>{edit.partialPath}</code>.
              </p>
            )}
            <div className="remote-editor-actions">
              <button
                type="button"
                disabled={busy || !edit.hasCopy || edit.phase === 'downloading'}
                onClick={() => void perform(() => window.mterminal.reopenRemoteEdit())}
              >
                Open editor
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={busy || !canUpload}
                onClick={() => void perform(() => window.mterminal.uploadRemoteEdit())}
              >
                Upload changes
              </button>
              <button
                type="button"
                disabled={busy || uploading}
                onClick={() =>
                  void perform(async () => {
                    const directory = await window.mterminal.finishRemoteEdit('keep');
                    setNotice(
                      directory ? `Kept working folder: ${directory}` : 'Editing session finished.',
                    );
                  })
                }
              >
                {edit.phase === 'downloading'
                  ? 'Cancel preparation and keep copy'
                  : 'Keep copy and finish'}
              </button>
              <button
                type="button"
                disabled={
                  busy || uploading || edit.phase === 'downloading' || !edit.workingDirectory
                }
                onClick={() => setDiscarding(true)}
              >
                Discard local copy…
              </button>
            </div>
            <p className="remote-editor-help">
              Saves stay local until Upload changes. Remote changes require review in the queue.
              Copies are plaintext; replacements use mode 0600 where supported and retain a remote
              backup.
            </p>
          </>
        )}
      </div>
      {discarding && edit && (
        <ConfirmDialog
          title="Discard remote editing copy?"
          confirmLabel="Discard local copy"
          danger
          onCancel={() => setDiscarding(false)}
          onConfirm={async () => {
            await window.mterminal.finishRemoteEdit('discard');
            setDiscarding(false);
            setNotice('Local working folder discarded. Remote files and backups were kept.');
          }}
        >
          <p>
            {edit.title} · {edit.remoteDirectory}/{edit.name}
          </p>
          <p className="file-operation-path">{edit.workingDirectory}</p>
          <p>
            Close the external editor first. This permanently deletes the entire local working
            folder, including saved edits, upload snapshots and editor backup files. Unsaved editor
            buffers cannot be detected. Remote files and backups are kept.
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}
