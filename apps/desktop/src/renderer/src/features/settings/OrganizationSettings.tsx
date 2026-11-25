import { useState } from 'react';
import type { OrganizationAction, OrganizationView } from '../../../../shared/accounts.js';
import { AdministrativeEvents } from './AdministrativeEvents';
import { OrganizationVaults } from './OrganizationVaults';
import { ConfirmDialog, errorMessage } from '../../components/ConfirmDialog';

interface PendingChange {
  action: OrganizationAction;
  label: string;
  description: string;
}

export function OrganizationSettings({ busy }: { busy: boolean }) {
  const [view, setView] = useState<OrganizationView>();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [confirmation, setConfirmation] = useState<PendingChange>();
  const [vaultId, setVaultId] = useState<string>();
  const vaultOrganization = view?.organizations.find((organization) => organization.id === vaultId);
  const roster = view?.roster;
  const managed = view?.organizations.find(
    (organization) => organization.id === roster?.organizationId,
  );
  const disabled = busy || working;

  async function request(action: OrganizationAction) {
    setError('');
    setWorking(true);
    try {
      const next = await window.mterminal.organizations(action);
      setView(next);
      if (action.kind === 'create') setName('');
      if (action.kind === 'invite' || roster?.organizationId !== next.roster?.organizationId)
        setEmail('');
    } finally {
      setWorking(false);
    }
  }

  async function run(action: OrganizationAction) {
    try {
      await request(action);
    } catch (cause) {
      setError(errorMessage(cause, 'Could not update organizations.'));
    }
  }

  return (
    <section aria-label="Organizations">
      <h3>Organizations</h3>
      <div className="settings-actions">
        <button
          className="secondary-button"
          type="button"
          disabled={disabled}
          onClick={() => void run({ kind: 'status' })}
        >
          {view ? 'Refresh organizations' : 'Show organizations'}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {view && (
        <>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run({ kind: 'create', name });
            }}
          >
            <label>
              Organization name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={80}
                disabled={disabled}
              />
            </label>
            <div className="settings-actions">
              <button className="primary-button" type="submit" disabled={disabled || !name.trim()}>
                Create organization
              </button>
            </div>
          </form>
          {view.organizations.length === 0 && <p>You don’t belong to any organizations yet.</p>}
          {view.organizations.length > 0 && (
            <ul>
              {view.organizations.map((organization) => (
                <li key={organization.id}>
                  {organization.name} · {organization.owner ? 'Owner' : 'Member'}
                  <div className="settings-actions">
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={disabled}
                      aria-label={`Vaults for ${organization.name}`}
                      aria-expanded={vaultId === organization.id}
                      onClick={() =>
                        setVaultId(vaultId === organization.id ? undefined : organization.id)
                      }
                    >
                      Vaults
                    </button>
                    {organization.owner ? (
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={disabled}
                        aria-label={`Manage ${organization.name}`}
                        onClick={() =>
                          void run({ kind: 'manage', organizationId: organization.id })
                        }
                      >
                        Manage
                      </button>
                    ) : (
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={disabled}
                        aria-label={`Leave ${organization.name}`}
                        onClick={() =>
                          setConfirmation({
                            action: { kind: 'leave', organizationId: organization.id },
                            label: 'Leave organization',
                            description: `You’ll lose access to ${organization.name}. You’ll need a new invitation to rejoin.`,
                          })
                        }
                      >
                        Leave
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <h4>Your invitations</h4>
          {view.invitations.length === 0 && <p>No pending invitations.</p>}
          {view.invitations.length > 0 && (
            <ul>
              {view.invitations.map((invitation) => (
                <li key={invitation.id}>
                  {invitation.organizationName} · Expires{' '}
                  {new Date(invitation.expiresAt).toLocaleString()}
                  <div className="settings-actions">
                    <button
                      className="primary-button"
                      type="button"
                      disabled={disabled}
                      onClick={() => void run({ kind: 'accept', invitationId: invitation.id })}
                    >
                      Accept
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={disabled}
                      onClick={() => void run({ kind: 'decline', invitationId: invitation.id })}
                    >
                      Decline
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {vaultOrganization && (
        <OrganizationVaults
          key={vaultOrganization.id}
          organization={vaultOrganization}
          busy={disabled}
        />
      )}
      {roster && managed && (
        <section aria-label={`Manage ${managed.name}`}>
          <h4>{managed.name} members</h4>
          <ul>
            {roster.members.map((member) => (
              <li key={member.id}>
                {member.email}
                {member.owner && ' · Owner'}
                {!member.owner && (
                  <div className="settings-actions">
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={disabled}
                      aria-label={`Transfer ownership to ${member.email}`}
                      onClick={() =>
                        setConfirmation({
                          action: {
                            kind: 'transfer',
                            organizationId: roster.organizationId,
                            memberId: member.id,
                          },
                          label: 'Transfer ownership',
                          description: `${member.email} will become the owner of ${managed.name}. You’ll stay a member.`,
                        })
                      }
                    >
                      Transfer ownership
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={disabled}
                      aria-label={`Remove ${member.email}`}
                      onClick={() =>
                        setConfirmation({
                          action: {
                            kind: 'remove',
                            organizationId: roster.organizationId,
                            memberId: member.id,
                          },
                          label: 'Remove member',
                          description: `${member.email} will lose access to ${managed.name}.`,
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <h4>Invite a member</h4>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run({ kind: 'invite', organizationId: roster.organizationId, email });
            }}
          >
            <label>
              Account email
              <input
                type="email"
                maxLength={254}
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={disabled}
              />
            </label>
            <p className="field-hint">
              The invitation appears in mTerminal for the account with this verified email.
            </p>
            <div className="settings-actions">
              <button className="primary-button" type="submit" disabled={disabled || !email.trim()}>
                Invite member
              </button>
            </div>
          </form>
          {roster.invitations.length > 0 && (
            <ul aria-label="Outgoing invitations">
              {roster.invitations.map((invitation) => (
                <li key={invitation.id}>
                  {invitation.email} · Expires {new Date(invitation.expiresAt).toLocaleString()}
                  <div className="settings-actions">
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={disabled}
                      aria-label={`Cancel invitation for ${invitation.email}`}
                      onClick={() =>
                        void run({
                          kind: 'cancel-invite',
                          organizationId: roster.organizationId,
                          invitationId: invitation.id,
                        })
                      }
                    >
                      Cancel invitation
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <AdministrativeEvents key={managed.id} organizationId={managed.id} busy={disabled} />
        </section>
      )}
      {confirmation && (
        <ConfirmDialog
          title={`${confirmation.label}?`}
          confirmLabel={confirmation.label}
          danger
          onCancel={() => setConfirmation(undefined)}
          onConfirm={async () => {
            await request(confirmation.action);
            setConfirmation(undefined);
          }}
        >
          <p>{confirmation.description}</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
