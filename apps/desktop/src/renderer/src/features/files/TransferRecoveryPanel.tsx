import { useEffect, useState } from 'react';
import type { TransferRecoveryRecord } from '../../../../shared/transfers';
import { ConfirmDialog } from '../../components/ConfirmDialog';

export function TransferRecoveryPanel() {
  const [records, setRecords] = useState<TransferRecoveryRecord[]>([]);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<TransferRecoveryRecord | null>(null);
  useEffect(() => {
    let mounted = true;
    let version = 0;
    const refresh = () => {
      const request = ++version;
      void window.mterminal.listTransferRecovery().then(
        (items) => {
          if (mounted && request === version) {
            setRecords(items);
            setError('');
          }
        },
        (cause: unknown) => {
          if (mounted && request === version)
            setError(cause instanceof Error ? cause.message : 'Unable to load recovery records.');
        },
      );
    };
    const off = window.mterminal.onTransfersChanged(refresh);
    refresh();
    return () => {
      mounted = false;
      off();
    };
  }, []);
  if (!records.length && !error) return null;
  return (
    <section className="transfer-queue transfer-recovery" aria-label="Saved transfer recovery">
      <header>
        <strong>Saved transfer recovery</strong>
        <span>{records.length} records</span>
      </header>
      {error && <p role="alert">{error}</p>}
      <p className="transfer-empty">
        Inspect these paths before retrying. Listed temporary and backup paths may be absent; an
        interrupted publication may already have completed. No transfer resumes automatically.
      </p>
      <ol>
        {records.map((record) => (
          <li key={record.id}>
            <div className="transfer-job-heading">
              <strong>
                {record.direction === 'upload' ? 'Upload' : 'Download'} · {record.name}
              </strong>
              <span>
                {record.phase === 'settled' ? record.state : `Interrupted · ${record.phase}`}
              </span>
              <button
                type="button"
                aria-label={`Forget recovery record for ${record.name}`}
                onClick={() => setSelected(record)}
              >
                Forget record…
              </button>
            </div>
            <p>
              {record.peer
                ? `${record.peer.username}@${record.peer.address}:${record.peer.port}`
                : record.title}
            </p>
            {record.peer && (
              <p>
                Recorded host key: <code>{record.peer.fingerprint}</code>
              </p>
            )}
            <p>
              Local folder: <code>{record.localDirectory}</code> · Remote folder:{' '}
              <code>{record.remoteDirectory}</code>
            </p>
            {record.source && (
              <p>
                Original source: <code>{record.source.path}</code>
              </p>
            )}
            {record.destination && (
              <p>
                Recorded destination: <code>{record.destination.path}</code>
              </p>
            )}
            {record.partialPath && (
              <p>
                Possible temporary file ({record.direction === 'upload' ? 'remote' : 'local'}):{' '}
                <code>{record.partialPath}</code>
              </p>
            )}
            {record.backupPath && (
              <p>
                Possible backup ({record.direction === 'upload' ? 'remote' : 'local'}):{' '}
                <code>{record.backupPath}</code>
              </p>
            )}
            <p>
              Last recorded:{' '}
              <time dateTime={record.updatedAt}>{new Date(record.updatedAt).toLocaleString()}</time>
            </p>
          </li>
        ))}
      </ol>
      {selected && (
        <ConfirmDialog
          title="Forget recovery record?"
          confirmLabel="Forget record"
          onCancel={() => setSelected(null)}
          onConfirm={async () => {
            await window.mterminal.forgetTransferRecovery(selected.id);
            setRecords((items) => items.filter((item) => item.id !== selected.id));
            setSelected(null);
          }}
        >
          <p>
            Forget the saved record for <strong>{selected.name}</strong> on {selected.title}?
          </p>
          <p>
            This removes only the record. Temporary files, backups and destinations stay on disk.
            Copy any paths you still need before continuing.
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}
