import { useState } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import type { WorkspaceSyncResult } from '../../../../shared/workspace-sync.js';

export function WorkspaceSyncReview({
  review,
  busy,
  close,
  apply,
}: {
  review: Extract<WorkspaceSyncResult, { kind: 'review' }>;
  busy: boolean;
  close: () => void;
  apply: (target: 'cloud' | 'local', records: string[]) => Promise<void>;
}) {
  const [target, setTarget] = useState<'cloud' | 'local'>('cloud');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const records = review.records.filter(
    (item) => target === 'cloud' || item.cloud || item.cloudDeleted,
  );
  const pageSize = 20;
  const deletions = records.filter(
    (item) => selected.has(item.key) && (target === 'cloud' ? !item.local : item.cloudDeleted),
  ).length;

  return (
    <div className="workspace-sync-review" role="region" aria-label="Workspace sync review">
      <h4>Review differences at cloud revision {review.revision}</h4>
      <p>
        Select the records to change. Related hosts, groups, or identities may need to be selected
        together.
      </p>
      <label>
        Apply selected changes to{' '}
        <select
          value={target}
          disabled={busy}
          onChange={(event) => {
            setTarget(event.target.value === 'cloud' ? 'cloud' : 'local');
            setPage(0);
            setSelected(new Set());
          }}
        >
          <option value="cloud">Cloud copy</option>
          <option value="local">This device</option>
        </select>
      </label>
      {records.length === 0 && <p>No differences for this direction.</p>}
      <ul>
        {records.slice(page * pageSize, (page + 1) * pageSize).map((item) => (
          <li key={item.key}>
            <label>
              <input
                type="checkbox"
                checked={selected.has(item.key)}
                disabled={busy}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setSelected((current) => {
                    const updated = new Set(current);
                    if (checked) updated.add(item.key);
                    else updated.delete(item.key);
                    return updated;
                  });
                }}
              />{' '}
              {item.label}
              {(target === 'cloud' ? !item.local : item.cloudDeleted) ? ' · Delete' : ''}
            </label>
            <details>
              <summary>Compare values</summary>
              <p>This device</p>
              <pre>{item.local ?? 'Absent on this device'}</pre>
              <p>Cloud copy</p>
              <pre>
                {item.cloud ??
                  (item.cloudDeleted ? 'Deleted from the cloud' : 'Absent from the cloud')}
              </pre>
            </details>
          </li>
        ))}
      </ul>
      <div className="settings-actions">
        {records.length > pageSize && (
          <>
            <button
              type="button"
              className="secondary-button"
              disabled={!page}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={(page + 1) * pageSize >= records.length}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </>
        )}
        <button
          type="button"
          className="primary-button"
          disabled={busy || selected.size === 0}
          onClick={() => setConfirming(true)}
        >
          Apply {selected.size} selected
        </button>
        <button type="button" className="secondary-button" disabled={busy} onClick={close}>
          Close review
        </button>
      </div>
      {confirming && (
        <ConfirmDialog
          title="Apply selected workspace changes?"
          confirmLabel="Apply changes"
          danger={deletions > 0}
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            try {
              await apply(target, [...selected]);
            } finally {
              setConfirming(false);
            }
          }}
        >
          <p>
            {selected.size} selected records will change in{' '}
            {target === 'cloud' ? 'the cloud copy' : 'this workspace'}.{' '}
            {deletions ? `${deletions} selected records will be deleted.` : ''}
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
