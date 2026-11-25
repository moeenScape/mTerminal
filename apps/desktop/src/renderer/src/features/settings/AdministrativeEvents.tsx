import { useState } from 'react';
import type { AdministrativeChange, AdministrativePage } from '../../../../shared/accounts.js';
import { errorMessage } from '../../components/ConfirmDialog';

function describe(change: AdministrativeChange): string {
  switch (change.kind) {
    case 'organization-created':
      return 'Created the organization';
    case 'invitation-sent':
      return `Invited ${change.email}`;
    case 'invitation-cancelled':
      return `Cancelled the invitation for ${change.email}`;
    case 'invitation-accepted':
      return 'Accepted an invitation';
    case 'invitation-declined':
      return 'Declined an invitation';
    case 'member-left':
      return 'Left the organization';
    case 'member-removed':
      return `Removed ${change.email}`;
    case 'ownership-transferred':
      return `Transferred ownership to ${change.email}`;
    case 'vault-created':
      return `Created vault “${change.vaultName}”`;
    case 'vault-visibility':
      return change.allMembers
        ? `Allowed all members to read “${change.vaultName}”`
        : `Restricted access to “${change.vaultName}”`;
    case 'vault-grant':
      return change.grant
        ? `Set ${change.email} to ${change.grant === 'reader' ? 'Reader' : 'Editor'} for “${change.vaultName}”`
        : `Cleared the grant for ${change.email} on “${change.vaultName}”`;
    case 'vault-published':
      return `Published revision ${change.revision} of “${change.vaultName}”`;
  }
}

export function AdministrativeEvents({
  organizationId,
  busy,
}: {
  organizationId: string;
  busy: boolean;
}) {
  const [page, setPage] = useState<AdministrativePage>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function load(before?: string) {
    setLoading(true);
    setError('');
    try {
      const next = await window.mterminal.organizationEvents({
        organizationId,
        ...(before ? { before } : {}),
      });
      setPage(next);
    } catch (cause) {
      setPage(undefined);
      setError(errorMessage(cause, 'Could not load administrative events.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section aria-label="Administrative events">
      <h4>Administrative events</h4>
      <div className="settings-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={busy || loading}
          onClick={() => void load()}
        >
          {page ? 'Show newest events' : 'Show administrative events'}
        </button>
        {page?.nextBefore && (
          <button
            type="button"
            className="secondary-button"
            disabled={busy || loading}
            onClick={() => void load(page.nextBefore!)}
          >
            Show older events
          </button>
        )}
      </div>
      {loading && <p role="status">Loading administrative events…</p>}
      {error && <p role="alert">{error}</p>}
      {page &&
        (page.events.length ? (
          <ol aria-label="Event history">
            {page.events.map(({ id, actorEmail, occurredAt, change }) => (
              <li key={id}>
                <strong>{describe(change)}</strong>
                <p>
                  {actorEmail} ·{' '}
                  <time dateTime={occurredAt}>{new Date(occurredAt).toLocaleString()}</time>
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p>No administrative events have been recorded.</p>
        ))}
    </section>
  );
}
