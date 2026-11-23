import { useState } from 'react';
import {
  sharedVaultCategories,
  type SharedVaultAction,
  type SharedVaultCategory,
  type SharedVaultView,
  type VaultDescriptor,
} from '../../../../shared/organization-vault.js';
import { ConfirmDialog, errorMessage } from '../../components/ConfirmDialog';

const categories = Object.keys(sharedVaultCategories) as SharedVaultCategory[];
const publicationDetails: Record<SharedVaultCategory, string> = {
  workspace:
    'This publishes all locally saved host, group, and identity profiles in this category. Host addresses and usernames are included.',
  snippets:
    'This publishes all local snippet commands. Check the commands for secrets before sharing. Startup assignments stay local.',
  settings: 'This publishes appearance, navigation shortcuts, autocomplete, and copy on select.',
};
const importDetails: Record<SharedVaultCategory, string> = {
  workspace:
    'New hosts, groups, and identities are added to your local workspace. A conflict stops the import.',
  snippets: 'New snippets are added to your local vault. Check the commands before using them.',
  settings:
    'This replaces your appearance, navigation shortcuts, autocomplete, and copy-on-select settings.',
};

export function SharedVaultSettings({
  organizationId,
  vault,
  busy,
}: {
  organizationId: string;
  vault: VaultDescriptor;
  busy: boolean;
}) {
  const canPublish = vault.access === 'owner' || vault.access === 'editor';
  const ids = { organizationId, vaultId: vault.id };
  const [key, setKey] = useState('');
  const [view, setView] = useState<SharedVaultView>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [confirmation, setConfirmation] = useState<{
    kind: 'publish' | 'import';
    category: SharedVaultCategory;
  }>();
  const disabled = pending || busy;
  const document = view?.document;

  async function request(action: SharedVaultAction) {
    setError('');
    setMessage('');
    setPending(true);
    try {
      const next = await window.mterminal.organizationVault(action);
      if (action.kind === 'generate-key' && next.vaultKey) {
        setKey(next.vaultKey);
        setView({ revision: next.revision, document: { version: 1 } });
        setMessage('Save this key and share it privately with members who need the vault.');
      } else {
        setView(next);
        if (action.kind === 'publish') setMessage(`Published vault revision ${next.revision}.`);
        if (action.kind === 'import')
          setMessage(
            action.category === 'settings'
              ? 'Shared settings applied.'
              : `Added ${next.imported ?? 0} local records.`,
          );
      }
    } finally {
      setPending(false);
    }
  }

  async function open(kind: 'generate-key' | 'open') {
    try {
      await request(kind === 'open' ? { kind, ...ids, key: key.trim() } : { kind, ...ids });
    } catch (cause) {
      setView(undefined);
      setError(errorMessage(cause, 'Could not open the shared vault.'));
    }
  }

  return (
    <section aria-label={`Shared vault for ${vault.name}`}>
      <h4>{vault.name} shared vault</h4>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void open('open');
        }}
      >
        <label>
          Shared vault key
          <input
            type="password"
            value={key}
            onChange={(event) => {
              setKey(event.target.value);
              setView(undefined);
              setMessage('');
              setError('');
            }}
            maxLength={128}
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            required
          />
        </label>
        <div className="settings-actions">
          <button className="secondary-button" type="submit" disabled={disabled || !key.trim()}>
            Open vault
          </button>
          {canPublish && (!view || view.revision === 0) && (
            <button
              className="secondary-button"
              type="button"
              disabled={disabled}
              onClick={() => void open('generate-key')}
            >
              Generate vault key
            </button>
          )}
          {key && (
            <button
              className="secondary-button"
              type="button"
              disabled={disabled}
              onClick={async () => {
                try {
                  await window.mterminal.writeClipboardText(key.trim());
                  setMessage('Vault key copied.');
                } catch (cause) {
                  setError(errorMessage(cause, 'Could not copy the vault key.'));
                }
              }}
            >
              Copy vault key
            </button>
          )}
        </div>
      </form>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {document && view && (
        <>
          <p>
            {view.revision
              ? `Vault revision ${view.revision}`
              : 'This vault has no published content.'}
          </p>
          <ul>
            {categories.map((category) => (
              <li key={category}>
                <strong>{sharedVaultCategories[category]}</strong>
                {!document[category] && <span> · Unpublished</span>}
                {category === 'workspace' && document.workspace && (
                  <details>
                    <summary>
                      {document.workspace.hosts.length} hosts, {document.workspace.groups.length}{' '}
                      groups, {document.workspace.identities.length} identities
                    </summary>
                    <ul>
                      {document.workspace.hosts.map((host) => (
                        <li key={host.id}>
                          Host · {host.name} ({host.address})
                        </li>
                      ))}
                      {document.workspace.groups.map((group) => (
                        <li key={group.path}>Group · {group.path}</li>
                      ))}
                      {document.workspace.identities.map((identity) => (
                        <li key={identity.id}>Identity · {identity.name}</li>
                      ))}
                    </ul>
                  </details>
                )}
                {category === 'snippets' && document.snippets && (
                  <details>
                    <summary>{document.snippets.length} snippets</summary>
                    {document.snippets.map((snippet) => (
                      <details key={snippet.id}>
                        <summary>{snippet.name}</summary>
                        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                          {snippet.command}
                        </pre>
                      </details>
                    ))}
                  </details>
                )}
                {category === 'settings' && document.settings && (
                  <ul>
                    <li>
                      Appearance · {document.settings.appearance === 'dark' ? 'Dark' : 'Light'}
                    </li>
                    <li>
                      Navigation shortcuts · {document.settings.navigationShortcuts ? 'On' : 'Off'}
                    </li>
                    <li>Autocomplete · {document.settings.autocomplete ? 'On' : 'Off'}</li>
                    <li>Copy on select · {document.settings.copyOnSelect ? 'On' : 'Off'}</li>
                  </ul>
                )}
                <div className="settings-actions">
                  {canPublish && (
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={disabled}
                      aria-label={`Publish ${sharedVaultCategories[category].toLowerCase()}`}
                      onClick={() => setConfirmation({ kind: 'publish', category })}
                    >
                      Publish
                    </button>
                  )}
                  {document[category] && (
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={disabled}
                      aria-label={`Import ${sharedVaultCategories[category].toLowerCase()}`}
                      onClick={() => setConfirmation({ kind: 'import', category })}
                    >
                      {category === 'settings' ? 'Apply settings' : 'Add locally'}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {confirmation && view && (
        <ConfirmDialog
          title={
            confirmation.kind === 'publish' ? `Publish to ${vault.name}?` : 'Add to this device?'
          }
          confirmLabel={
            confirmation.kind === 'publish' ? 'Publish category' : 'Apply to this device'
          }
          onCancel={() => setConfirmation(undefined)}
          onConfirm={async () => {
            await request({
              ...confirmation,
              ...ids,
              key: key.trim(),
              revision: view.revision,
            });
            setConfirmation(undefined);
          }}
        >
          <p>
            {confirmation.kind === 'publish'
              ? publicationDetails[confirmation.category]
              : importDetails[confirmation.category]}
          </p>
          {confirmation.kind === 'publish' && (
            <p>This replaces the published category. Other categories are preserved.</p>
          )}
        </ConfirmDialog>
      )}
    </section>
  );
}
