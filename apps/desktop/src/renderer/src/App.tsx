import { isWorkspaceShortcut } from './components/keyboard';
import { defaultPreferences, type Preferences } from '../../shared/preferences';
import { useEffect, useState } from 'react';
import type { AppInfo } from '../../shared/app-info';
import { Icon } from './components/Icon';
import { ViewTabs, viewItems, type ViewId } from './components/ViewTabs';
import { HostsView } from './features/hosts/HostsView';
import { SettingsView } from './features/settings/SettingsView';
import { WorkspaceView } from './features/workspace/WorkspaceView';

type AppState = { status: 'loading' } | { status: 'ready'; info: AppInfo } | { status: 'error' };

export function App() {
  const [state, setState] = useState<AppState>({ status: 'loading' });
  const [activeView, setActiveView] = useState<ViewId>('hosts');
  const [preferences, setPreferences] = useState<Preferences>(defaultPreferences);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [preferencesError, setPreferencesError] = useState('');
  const [terminalCount, setTerminalCount] = useState(0);
  const [hostQuery, setHostQuery] = useState('');
  const [sshRequest, setSshRequest] = useState<{
    id: string;
    hostId: string;
    title: string;
  } | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadAppInfo() {
      try {
        const info = await window.mterminal.getAppInfo();
        if (mounted) setState({ status: 'ready', info });
      } catch {
        if (mounted) setState({ status: 'error' });
      }
    }

    void loadAppInfo();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    void window.mterminal
      .getPreferences()
      .then((value) => {
        if (mounted) {
          setPreferences(value);
          setPreferencesReady(true);
        }
      })
      .catch(() => {
        if (mounted) setPreferencesError('Unable to load preferences. Restart the application.');
      });
    return () => {
      mounted = false;
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.appearance = preferences.appearance;
    if (!preferences.navigationShortcuts) return;
    function navigate(event: KeyboardEvent) {
      if (document.querySelector('dialog[open]')) return;
      if (!isWorkspaceShortcut(event)) return;
      const view = viewItems[Number(event.key) - 1];
      if (view) {
        event.preventDefault();
        setActiveView(view.id);
      }
    }
    window.addEventListener('keydown', navigate);
    return () => window.removeEventListener('keydown', navigate);
  }, [preferences]);
  async function savePreferences(value: Preferences) {
    const saved = await window.mterminal.savePreferences(value);
    setPreferences(saved);
  }
  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Workspace navigation">
        <div className="brand">
          <Icon name="terminal" className="brand-symbol" />
          <span>mTerminal</span>
        </div>
        <div className="vault-summary">
          <Icon name="lock" />
          <div>
            <strong>Local vault</strong>
            <span>On this device</span>
          </div>
        </div>
        <p className="sidebar-label">WORKSPACE</p>
        <nav aria-label="Main navigation">
          {viewItems.map((view) => (
            <button
              key={view.id}
              type="button"
              className="nav-item"
              aria-current={activeView === view.id ? 'page' : undefined}
              onClick={() => setActiveView(view.id)}
            >
              <Icon name={view.icon} />
              <span>{view.label}</span>
              {view.id === 'hosts' && <span className="nav-count">0</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="local-indicator" aria-hidden="true" />
          Local workspace
        </div>
      </aside>

      <main className="workspace">
        <ViewTabs activeView={activeView} onViewChange={setActiveView} />
        <section
          id="view-panel"
          role="tabpanel"
          aria-labelledby={`view-tab-${activeView}`}
          tabIndex={0}
          className="view-panel"
        >
          {activeView === 'hosts' && (
            <HostsView
              query={hostQuery}
              onQueryChange={setHostQuery}
              onOpenWorkspace={() => setActiveView('workspace')}
              onConnect={(host) => {
                setSshRequest({
                  id: crypto.randomUUID(),
                  hostId: host.id,
                  title: host.name.slice(0, 64),
                });
                setActiveView('workspace');
              }}
            />
          )}
          <WorkspaceView
            sshRequest={sshRequest}
            navigationShortcuts={preferences.navigationShortcuts}
            active={activeView === 'workspace'}
            appearance={preferences.appearance}
            onCountChange={setTerminalCount}
          />
          {activeView === 'settings' && (
            <SettingsView
              key={String(preferencesReady)}
              preferences={preferences}
              ready={preferencesReady}
              loadError={preferencesError}
              onSave={savePreferences}
              info={state.status === 'ready' ? state.info : undefined}
            />
          )}
        </section>

        <footer className="status-bar">
          <span role="status" className={state.status === 'error' ? 'status-error' : ''}>
            <span className={`status-dot status-dot--${state.status}`} aria-hidden="true" />
            {state.status === 'ready'
              ? 'Application ready'
              : state.status === 'error'
                ? 'Application information unavailable. Please restart mTerminal.'
                : 'Starting application…'}
          </span>
          <div className="status-details">
            <span>
              {terminalCount} {terminalCount === 1 ? 'session' : 'sessions'}
            </span>
            {state.status === 'ready' && (
              <span className="version">
                {state.info.platform} <span aria-hidden="true">·</span> v{state.info.version}
              </span>
            )}
          </div>
        </footer>
      </main>
    </div>
  );
}
