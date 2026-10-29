import { useState } from 'react';
import type { Preferences } from '../../../../shared/preferences';
import type { AppInfo } from '../../../../shared/app-info';

export function SettingsView({
  info,
  preferences,
  ready,
  loadError,
  onSave,
}: {
  info: AppInfo | undefined;
  preferences: Preferences;
  ready: boolean;
  loadError: string;
  onSave: (value: Preferences) => Promise<void>;
}) {
  const [draft, setDraft] = useState(preferences);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMessage, setBackupMessage] = useState('');
  const platformNames: Record<string, string> = {
    linux: 'Linux',
    darwin: 'macOS',
    win32: 'Windows',
  };

  return (
    <div className="page-view">
      <header className="page-header">
        <div>
          <h1>Settings</h1>
          <p>Application information and preferences.</p>
        </div>
      </header>
      <div className="settings-body">
        <section aria-labelledby="preferences-heading">
          <h2 id="preferences-heading">Preferences</h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setSaving(true);
              setMessage('');
              void onSave(draft)
                .then(() => setMessage('Preferences saved.'))
                .catch((error: unknown) =>
                  setMessage(
                    error instanceof Error
                      ? error.message
                      : 'Unable to save preferences. Try again.',
                  ),
                )
                .finally(() => setSaving(false));
            }}
          >
            <fieldset disabled={!ready || saving} className="preference-fields">
              <div className="setting-row">
                <label htmlFor="appearance">Appearance</label>
                <select
                  id="appearance"
                  value={draft.appearance}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      appearance: event.target.value as Preferences['appearance'],
                    })
                  }
                >
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </select>
              </div>
              <div className="setting-row">
                <label htmlFor="default-shell">Default shell executable</label>
                <input
                  id="default-shell"
                  value={draft.defaultShell}
                  maxLength={1024}
                  spellCheck={false}
                  aria-describedby="default-shell-hint"
                  placeholder={
                    info?.platform === 'win32'
                      ? 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
                      : '/bin/bash'
                  }
                  onChange={(event) => setDraft({ ...draft, defaultShell: event.target.value })}
                />
                <p id="default-shell-hint" className="field-hint">
                  Leave blank to use your Unix login shell or the platform fallback (Bash on Linux,
                  Zsh on macOS, PowerShell on Windows). Enter an absolute path without arguments or
                  quotes. Applies to new sessions.
                </p>
              </div>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={draft.navigationShortcuts}
                  onChange={(event) =>
                    setDraft({ ...draft, navigationShortcuts: event.target.checked })
                  }
                />
                Enable Ctrl+Alt+1/2/3 to open Hosts, Workspace, and Settings
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={draft.rememberWindow}
                  onChange={(event) => setDraft({ ...draft, rememberWindow: event.target.checked })}
                />
                Remember window size and maximized state
              </label>
              <div className="settings-actions">
                <button className="primary-button" type="submit">
                  {saving ? 'Saving…' : 'Save preferences'}
                </button>
                <p role="status" className="settings-status">
                  {loadError || message || (!ready ? 'Loading preferences…' : '')}
                </p>
              </div>
            </fieldset>
          </form>
        </section>
        <section aria-labelledby="backup-heading">
          <h2 id="backup-heading">Workspace backup</h2>
          <p className="section-description">
            Export or merge hosts, groups, SSH identities, and trusted host keys. Saved passwords
            and private keys are never included; keep the backup file in a secure location.
          </p>
          <div className="settings-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={backupBusy}
              onClick={() => {
                setBackupBusy(true);
                setBackupMessage('');
                void window.mterminal
                  .exportWorkspace()
                  .then((saved) =>
                    setBackupMessage(saved ? 'Backup exported.' : 'Export cancelled.'),
                  )
                  .catch(() => setBackupMessage('Unable to export the workspace backup.'))
                  .finally(() => setBackupBusy(false));
              }}
            >
              Export backup
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={backupBusy}
              onClick={() => {
                setBackupBusy(true);
                setBackupMessage('');
                void window.mterminal
                  .importWorkspace()
                  .then((count) =>
                    setBackupMessage(
                      count === undefined ? 'Import cancelled.' : `Imported ${count} records.`,
                    ),
                  )
                  .catch((error: unknown) =>
                    setBackupMessage(
                      error instanceof Error ? error.message : 'Unable to import the backup.',
                    ),
                  )
                  .finally(() => setBackupBusy(false));
              }}
            >
              Import backup
            </button>
          </div>
          <p role="status" className="settings-status">
            {backupBusy ? 'Working…' : backupMessage}
          </p>
        </section>
        <section aria-labelledby="application-heading">
          <h2 id="application-heading">About</h2>
          <p className="section-description">Your local mTerminal installation.</p>
          <dl className="settings-list">
            <div>
              <dt>Name</dt>
              <dd>{info?.name ?? 'mTerminal'}</dd>
            </div>
            <div>
              <dt>Version</dt>
              <dd>{info?.version ?? 'Unavailable'}</dd>
            </div>
            <div>
              <dt>Platform</dt>
              <dd>{info ? (platformNames[info.platform] ?? info.platform) : 'Unavailable'}</dd>
            </div>
            <div>
              <dt>Storage</dt>
              <dd>Local workspace</dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  );
}
