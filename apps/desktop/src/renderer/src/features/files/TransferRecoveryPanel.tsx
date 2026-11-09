import { useEffect, useState } from 'react';
import type {
  TransferRecoveryRecord,
  PartialCleanupPreview,
  TransferResumePreview,
} from '../../../../shared/transfers';
import { fileSize } from './file-browser';
import { ConfirmDialog } from '../../components/ConfirmDialog';

export function TransferRecoveryPanel({
  sessionId,
  onCleaned,
}: {
  sessionId: string | null;
  onCleaned: () => void;
}) {
  const [records, setRecords] = useState<TransferRecoveryRecord[]>([]);
  const [error, setError] = useState('');
  const [inspecting, setInspecting] = useState<string | null>(null);
  const [cleanup, setCleanup] = useState<{
    preview: PartialCleanupPreview;
    sessionId: string;
  } | null>(null);
  const [resume, setResume] = useState<{
    preview: TransferResumePreview;
    sessionId: string;
  } | null>(null);
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
              {record.partialPath &&
                record.staging &&
                record.peer &&
                record.source &&
                !record.backupPath &&
                record.state !== 'uncertain' &&
                record.state !== 'completed' &&
                record.phase !== 'backup' &&
                record.phase !== 'publishing' && (
                  <button
                    type="button"
                    disabled={!sessionId || !!inspecting}
                    aria-label={`Preview resume for ${record.name}`}
                    onClick={() => {
                      if (!sessionId) return;
                      setInspecting(record.id);
                      setError('');
                      void window.mterminal
                        .inspectTransferResume(record.id, sessionId)
                        .then(
                          (preview) => setResume({ preview, sessionId }),
                          (cause: unknown) =>
                            setError(
                              cause instanceof Error ? cause.message : 'Unable to verify resume.',
                            ),
                        )
                        .finally(() => setInspecting(null));
                    }}
                  >
                    Resume…
                  </button>
                )}
              {record.partialPath && (
                <button
                  type="button"
                  disabled={!sessionId || !record.staging || !record.peer || !!inspecting}
                  aria-label={`Inspect temporary file for ${record.name}`}
                  onClick={() => {
                    if (!sessionId) return;
                    setInspecting(record.id);
                    setError('');
                    void window.mterminal
                      .inspectTransferPartial(record.id, sessionId)
                      .then(
                        (preview) => setCleanup({ preview, sessionId }),
                        (cause: unknown) =>
                          setError(
                            cause instanceof Error
                              ? cause.message
                              : 'Unable to verify the temporary file.',
                          ),
                      )
                      .finally(() => setInspecting(null));
                  }}
                >
                  {inspecting === record.id ? 'Inspecting…' : 'Inspect temporary file…'}
                </button>
              )}
              <button
                type="button"
                disabled={!!inspecting}
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
            {record.partialPath && (!record.staging || !record.peer) && (
              <p>Creation or connection evidence is unavailable; inspect this file manually.</p>
            )}
            {record.partialPath && record.staging && record.peer && !sessionId && (
              <p>Open Files in the matching SSH host/account tab to verify this temporary file.</p>
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
      {cleanup && cleanup.sessionId === sessionId && (
        <ConfirmDialog
          title="Delete verified temporary file?"
          confirmLabel="Delete temporary file"
          danger
          onCancel={() => setCleanup(null)}
          onConfirm={async () => {
            try {
              await window.mterminal.cleanupTransferPartial(cleanup.preview.token);
              setRecords((items) =>
                items.map((item) =>
                  item.id === cleanup.preview.recordId ? { ...item, partialPath: null } : item,
                ),
              );
              setCleanup(null);
            } catch (cause) {
              setCleanup(null);
              setError(
                cause instanceof Error
                  ? cause.message
                  : 'Cleanup failed. Inspect the paths before retrying.',
              );
            } finally {
              onCleaned();
            }
          }}
        >
          <p>Delete this verified {cleanup.preview.side} staging file only?</p>
          <p>
            <code>{cleanup.preview.file.path}</code> · {cleanup.preview.file.size} bytes
          </p>
          <p>
            {cleanup.preview.peer.username}@{cleanup.preview.peer.address}:
            {cleanup.preview.peer.port}
          </p>
          <p>
            Host key: <code>{cleanup.preview.peer.fingerprint}</code>
          </p>
          <p>
            The staged bytes match the unchanged source. Verification runs again before deletion.
            Destination files and backups are preserved.
          </p>
        </ConfirmDialog>
      )}
      {resume && resume.sessionId === sessionId && (
        <ConfirmDialog
          title="Resume verified transfer?"
          confirmLabel={resume.preview.destination ? 'Resume and replace' : 'Resume transfer'}
          danger={!!resume.preview.destination}
          onCancel={() => setResume(null)}
          onConfirm={async () => {
            try {
              await window.mterminal.resumeTransfer(resume.preview.token);
              setResume(null);
            } catch (cause) {
              setResume(null);
              setError(
                cause instanceof Error
                  ? cause.message
                  : 'Unable to resume. Inspect the paths before retrying.',
              );
            }
          }}
        >
          <p>
            Continue this {resume.preview.side} partial: <code>{resume.preview.file.path}</code>
          </p>
          <p>
            Verified: {fileSize(resume.preview.file.size)} / {fileSize(resume.preview.total)}.
            Remaining: {fileSize(resume.preview.remaining)}.
          </p>
          <p>
            {resume.preview.peer.username}@{resume.preview.peer.address}:{resume.preview.peer.port}
          </p>
          <p>
            Host key: <code>{resume.preview.peer.fingerprint}</code>
          </p>
          {resume.preview.destination ? (
            <p>
              Replace <code>{resume.preview.destination.path}</code> after copying completes. Its
              current contents will be retained in a new backup.
            </p>
          ) : (
            <p>The destination must remain absent. Existing files will not be overwritten.</p>
          )}
          <p>
            Files are verified again before writing. Cancellation or failure keeps the partial for
            inspection. Follow progress in Transfers.
          </p>
        </ConfirmDialog>
      )}
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
