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
        <section aria-labelledby="application-heading">
          <h2 id="application-heading">Application</h2>
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
        <section aria-labelledby="preferences-heading">
          <h2 id="preferences-heading">Preferences</h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setSaving(true);
              setMessage('');
              void onSave(draft)
                .then(() => setMessage('Preferences saved.'))
                .catch(() =>
                  setMessage('Unable to save preferences. Check disk space and try again.'),
                )
                .finally(() => setSaving(false));
            }}
          >
            <fieldset disabled={!ready || saving} className="preference-fields">
              <label>
                Appearance
                <select
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
              </label>
              <label>
                Default shell executable
                <input
                  value={draft.defaultShell}
                  maxLength={1024}
                  placeholder="System default"
                  onChange={(event) => setDraft({ ...draft, defaultShell: event.target.value })}
                />
              </label>
              <p className="section-description">
                Leave blank for the system default. This will apply to new local sessions when shell
                support is added; enter an executable path without arguments.
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={draft.navigationShortcuts}
                  onChange={(event) =>
                    setDraft({ ...draft, navigationShortcuts: event.target.checked })
                  }
                />{' '}
                Enable Ctrl+Alt+1/2/3 to open Hosts, Workspace, and Settings
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={draft.rememberWindow}
                  onChange={(event) => setDraft({ ...draft, rememberWindow: event.target.checked })}
                />{' '}
                Remember window size and maximized state
              </label>
              <button className="primary-button" type="submit">
                {saving ? 'Saving…' : 'Save preferences'}
              </button>
            </fieldset>
            <p role="status">{loadError || message || (!ready ? 'Loading preferences…' : '')}</p>
          </form>
        </section>
      </div>
    </div>
  );
}
