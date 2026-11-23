import { useState } from 'react';
import type { Organization } from '../../../../shared/accounts.js';
import type {
  VaultAccessAction,
  VaultAccessView,
  VaultGrant,
} from '../../../../shared/organization-vault.js';
import { ConfirmDialog, errorMessage } from '../../components/ConfirmDialog';
import { SharedVaultSettings } from './SharedVaultSettings';

type VaultChange = Extract<VaultAccessAction, { kind: 'grant' | 'visibility' }>;

export function OrganizationVaults({
  organization,
  busy,
}: {
  organization: Organization;
  busy: boolean;
}) {
  const [view, setView] = useState<VaultAccessView>();
  const [vaultId, setVaultId] = useState<string>();
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<{ action: VaultChange; description: string }>();
  const disabled = busy || pending;
  const organizationId = organization.id;
  const opened = view?.vaults.find((vault) => vault.id === vaultId);
  const roster = view?.administration;
  const managed = view?.vaults.find(
    (vault) => vault.id === roster?.vaultId && vault.access === 'owner',
  );

  async function request(action: VaultAccessAction) {
    setPending(true);
    setError('');
    try {
      setView(await window.mterminal.organizationVaultAccess(action));
      if (action.kind === 'create') setName('');
    } finally {
      setPending(false);
    }
  }

  async function run(action: VaultAccessAction) {
    try {
      await request(action);
    } catch (cause) {
      if (action.kind === 'list') setView(undefined);
      setError(errorMessage(cause, 'Could not load organization vaults.'));
    }
  }

  return (
    <section aria-label={`Vaults for ${organization.name}`}>
      <h4>{organization.name} vaults</h4>
      <div className="settings-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={disabled}
          onClick={() => void run({ kind: 'list', organizationId })}
        >
          {view ? 'Refresh vaults' : 'Show vaults'}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {view?.vaults.some((vault) => vault.access === 'owner') && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run({ kind: 'create', organizationId, name });
          }}
        >
          <label>
            Vault name
            <input
              value={name}
              maxLength={80}
              required
              disabled={disabled}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <button type="submit" className="primary-button" disabled={disabled || !name.trim()}>
            Create vault
          </button>
        </form>
      )}
      {view?.vaults.length === 0 && <p>No vaults are available to this account.</p>}
      {view && view.vaults.length > 0 && (
        <ul>
          {view.vaults.map((vault) => (
            <li key={vault.id}>
              <strong>{vault.name}</strong>
              {' · '}
              {vault.access === 'owner' ? 'Owner' : vault.access === 'editor' ? 'Editor' : 'Reader'}
              <div className="settings-actions">
                <button
                  type="button"
                  className="secondary-button"
                  aria-label={`${vaultId === vault.id ? 'Close' : 'Open'} ${vault.name}`}
                  aria-expanded={vaultId === vault.id}
                  disabled={disabled}
                  onClick={() => setVaultId(vaultId === vault.id ? undefined : vault.id)}
                >
                  {vaultId === vault.id ? 'Close vault' : 'Open vault'}
                </button>
                {vault.access === 'owner' && (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={disabled}
                    aria-label={`Manage access for ${vault.name}`}
                    onClick={() => void run({ kind: 'manage', organizationId, vaultId: vault.id })}
                  >
                    Manage access
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {managed && roster && (
        <section aria-label={`Access for ${managed.name}`}>
          <h4>{managed.name} access</h4>
          <p>
            {managed.allMembers
              ? 'All organization members can read this vault.'
              : 'Members need an explicit grant to access this vault.'}
          </p>
          <div className="settings-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={disabled}
              onClick={() =>
                setConfirmation({
                  action: {
                    kind: 'visibility',
                    organizationId,
                    vaultId: managed.id,
                    allMembers: !managed.allMembers,
                  },
                  description: managed.allMembers
                    ? `Only members with an explicit grant will be able to open ${managed.name}.`
                    : `All current and future organization members will be allowed to read ${managed.name} if they have its key.`,
                })
              }
            >
              {managed.allMembers ? 'Restrict to granted members' : 'Allow all members to read'}
            </button>
          </div>
          {roster.members.length === 0 && <p>Invite a member to grant them access.</p>}
          {roster.members.length > 0 && (
            <ul>
              {roster.members.map((member) => (
                <li key={member.id}>
                  <form
                    key={`${managed.id}:${member.id}:${member.grant}`}
                    onSubmit={(event) => {
                      event.preventDefault();
                      const choice = new FormData(event.currentTarget).get('grant');
                      const grant: VaultGrant | null =
                        choice === 'reader' || choice === 'editor' ? choice : null;
                      if (grant === member.grant) return;
                      const access = grant ?? (managed.allMembers ? 'reader' : null);
                      setConfirmation({
                        action: {
                          kind: 'grant',
                          organizationId,
                          vaultId: managed.id,
                          memberId: member.id,
                          grant,
                        },
                        description: `${member.email} will have ${access ? `${access} access` : 'no access'} to ${managed.name}.`,
                      });
                    }}
                  >
                    <label>
                      {member.email}
                      <select name="grant" defaultValue={member.grant ?? ''} disabled={disabled}>
                        <option value="">
                          {managed.allMembers ? 'Default · Reader' : 'No grant · No access'}
                        </option>
                        <option value="reader">Reader</option>
                        <option value="editor">Editor</option>
                      </select>
                    </label>
                    <button
                      type="submit"
                      className="secondary-button"
                      disabled={disabled}
                      aria-label={`Save access for ${member.email}`}
                    >
                      Save access
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {opened && (
        <SharedVaultSettings
          key={opened.id}
          organizationId={organizationId}
          vault={opened}
          busy={disabled}
        />
      )}
      {confirmation && (
        <ConfirmDialog
          title="Change vault access?"
          confirmLabel="Change access"
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
