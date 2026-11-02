import { useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { useModalDialog } from '../../components/ConfirmDialog';
import type { TransferJob, TransferFileInfo } from '../../../../shared/transfers';
import { fileSize } from './file-browser';

export function TransferConflictDialog({
  job,
  onClose,
}: {
  job: TransferJob;
  onClose: () => void;
}) {
  const ref = useModalDialog();
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const preview = job.conflict!;
  const replaceable = preview.replaceable && !job.partialPath && !job.backupPath;
  const choose = async (choice: 'replace' | 'skip' | 'cancel') => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (choice === 'cancel') await window.mterminal.cancelTransfer(job.id);
      else await window.mterminal.resolveTransferConflict(job.id, preview.token, choice);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to resolve this conflict.');
    } finally {
      setBusy(false);
    }
  };
  return createPortal(
    <dialog
      ref={ref}
      className="terminal-dialog transfer-conflict-dialog"
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) void choose('cancel');
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void choose('skip');
        }}
      >
        <h2 id={`${id}-title`}>Destination already exists</h2>
        <p>
          {job.title} · {job.direction === 'upload' ? 'Local → Remote' : 'Remote → Local'} ·{' '}
          {job.name}
        </p>
        <FileDetails label="Source" info={preview.source} />
        <FileDetails label="Existing destination" info={preview.destination} />
        <p>
          Skip leaves the destination unchanged. Replace copies the complete file first and keeps
          the previous destination at a named backup path shown in the queue. The replacement uses
          mode 0600 where supported; existing permissions are not copied.
        </p>
        {!replaceable && (
          <p className="dialog-error">
            Replacement is available only for regular files with usable metadata and no outstanding
            temporary or backup files. Inspect any reported paths and start a new transfer if
            needed.
          </p>
        )}
        {error && (
          <p role="alert" className="dialog-error">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="submit" autoFocus disabled={busy}>
            Skip
          </button>
          <button
            type="button"
            className="danger-button"
            disabled={busy || !replaceable}
            onClick={() => void choose('replace')}
          >
            Replace
          </button>
          <button type="button" disabled={busy} onClick={() => void choose('cancel')}>
            Cancel transfer
          </button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}
function FileDetails({ label, info }: { label: string; info: TransferFileInfo }) {
  return (
    <section className="transfer-conflict-details" aria-label={label}>
      <strong>{label}</strong>
      <p className="file-operation-path">{info.path}</p>
      <dl>
        <div>
          <dt>Type</dt>
          <dd>{info.kind}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{Number.isFinite(info.size) ? fileSize(info.size) : 'Unavailable'}</dd>
        </div>
        <div>
          <dt>Modified</dt>
          <dd>
            {Number.isFinite(info.modified)
              ? new Date(info.modified).toLocaleString()
              : 'Unavailable'}
          </dd>
        </div>
        <div>
          <dt>Permissions</dt>
          <dd>{info.permissions}</dd>
        </div>
      </dl>
    </section>
  );
}
