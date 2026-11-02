import { useEffect, useState } from 'react';
import { fileErrorMessages } from '../../../../shared/files';
import { transferActive, type TransferJob } from '../../../../shared/transfers';
import { fileSize } from './file-browser';

export function useTransfers() {
  const [jobs, setJobs] = useState<TransferJob[]>([]);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let mounted = true;
    let version = 0;
    let finished: Set<string> | undefined;
    let eventSeen = false;
    const refresh = () => {
      const request = ++version;
      void window.mterminal
        .listTransfers()
        .then((items) => {
          if (!mounted || request !== version) return;
          const settled = new Set(
            items.filter((job) => !transferActive(job.state)).map((job) => job.id),
          );
          if ((finished || eventSeen) && [...settled].some((id) => !finished?.has(id)))
            setRevision((current) => current + 1);
          finished = settled;
          setJobs(items);
          setError('');
        })
        .catch(() => {
          if (mounted && request === version)
            setError('Unable to load the transfer queue. Reopen Files to retry.');
        });
    };
    const off = window.mterminal.onTransfersChanged(() => {
      eventSeen = true;
      refresh();
    });
    refresh();
    return () => {
      mounted = false;
      off();
    };
  }, []);
  return { jobs, error, revision };
}

export function TransferQueueView({ jobs, error }: { jobs: TransferJob[]; error: string }) {
  const [notice, setNotice] = useState('');
  const perform = (action: Promise<void>) => {
    setNotice('');
    void action.catch((cause: unknown) =>
      setNotice(cause instanceof Error ? cause.message : 'Unable to update the queue.'),
    );
  };
  return (
    <section className="transfer-queue" aria-label="Transfer queue">
      <header>
        <strong>Transfers</strong>
        <span>{jobs.filter((job) => transferActive(job.state)).length} pending</span>
        <button
          type="button"
          disabled={!jobs.some((job) => !transferActive(job.state))}
          onClick={() => perform(window.mterminal.clearFinishedTransfers())}
        >
          Clear finished
        </button>
      </header>
      {(error || notice) && <p role="alert">{error || notice}</p>}
      {!jobs.length && !error && (
        <p className="transfer-empty">
          Choose Upload or Download from a file&apos;s Actions menu. Transfers run one at a time.
        </p>
      )}
      <ol>
        {jobs.map((job) => (
          <li key={job.id}>
            <div className="transfer-job-heading">
              <strong>
                {job.direction === 'upload' ? 'Upload' : 'Download'} · {job.name}
              </strong>
              <span role="status">{job.state}</span>
              {transferActive(job.state) && (
                <button
                  type="button"
                  disabled={job.state === 'cancelling'}
                  aria-label={`Cancel ${job.direction} ${job.name}`}
                  onClick={() => perform(window.mterminal.cancelTransfer(job.id))}
                >
                  {job.state === 'cancelling' ? 'Cancelling…' : 'Cancel'}
                </button>
              )}
            </div>
            <p>
              {job.title} · Local: <code>{job.localDirectory}</code> · Remote:{' '}
              <code>{job.remoteDirectory}</code>
            </p>
            <div className="transfer-progress">
              <progress
                aria-label={`${job.direction} progress for ${job.name}`}
                max={job.total || 1}
                value={job.state === 'completed' ? job.total || 1 : job.transferred}
              />
              <span>
                {fileSize(job.transferred)} / {job.total === null ? 'Waiting' : fileSize(job.total)}
              </span>
            </div>
            {job.error && <p className="file-error">{fileErrorMessages[job.error]}</p>}
            {job.partialPath && (
              <p className="file-error">
                A temporary file may remain: <code>{job.partialPath}</code>. Inspect it before
                removing it.
              </p>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
