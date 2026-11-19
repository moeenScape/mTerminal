import { isWorkspaceShortcut } from './components/keyboard';
import { defaultPreferences, type Preferences } from '../../shared/preferences';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import type { AppInfo } from '../../shared/app-info';
import type { VaultState } from '../../shared/vault';
import { Icon } from './components/Icon';
import { viewItems, type ViewId } from './components/views';
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
  const [hostCount, setHostCount] = useState(0);
  const [sessionBar, setSessionBar] = useState<HTMLDivElement | null>(null);
  const [hostQuery, setHostQuery] = useState('');
  const [vaultState, setVaultState] = useState<VaultState | null>(null);
  const [showVaultSetup, setShowVaultSetup] = useState(false);
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
    const off = window.mterminal.onVaultLocked(() => {
      setVaultState((current) =>
        current ? { ...current, configured: true, locked: true } : current,
      );
    });
    void window.mterminal
      .getVaultState()
      .then((value) => {
        if (mounted) setVaultState(value);
      })
      .catch(() => {
        if (mounted) setVaultState({ configured: true, locked: true, available: false });
      });
    return () => {
      mounted = false;
      off();
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
  const latestPreferences = useRef(preferences);
  useLayoutEffect(() => {
    latestPreferences.current = preferences;
  }, [preferences]);
  /** Saves settings changed from a terminal's tools panel on top of the latest preferences. */
  const changeToolsPreference = useCallback(async (patch: Partial<Preferences>) => {
    const saved = await window.mterminal.savePreferences({
      ...latestPreferences.current,
      ...patch,
    });
    latestPreferences.current = saved;
    setPreferences(saved);
  }, []);
  const toolsPreferences = useMemo(
    () => ({
      recordHistory: preferences.recordHistory,
      autocomplete: preferences.autocomplete,
      copyOnSelect: preferences.copyOnSelect,
    }),
    [preferences.recordHistory, preferences.autocomplete, preferences.copyOnSelect],
  );
  const vaultLabel =
    vaultState === null
      ? 'Checking vault…'
      : vaultState.configured
        ? vaultState.locked
          ? 'Vault locked'
          : 'Vault unlocked'
        : vaultState.available
          ? 'Vault not set up'
          : 'Secure storage unavailable';
  const counts: Partial<Record<ViewId, number>> = { hosts: hostCount, workspace: terminalCount };
  const activeLabel = viewItems.find((view) => view.id === activeView)!.label;
  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Workspace navigation">
        <div className="brand">
          <Icon name="terminal" className="brand-symbol" />
          <span className="brand-name">mTerminal</span>
        </div>
        <nav aria-label="Main navigation">
          {viewItems.map((view) => (
            <button
              key={view.id}
              type="button"
              className="nav-item"
              title={view.label}
              aria-current={activeView === view.id ? 'page' : undefined}
              onClick={() => setActiveView(view.id)}
            >
              <Icon name={view.icon} />
              <span className="nav-label">{view.label}</span>
              {counts[view.id] !== undefined && (
                <span className="nav-count" aria-hidden="true">
                  {counts[view.id]}
                </span>
              )}
            </button>
          ))}
        </nav>
      </aside>

      <main className="workspace">
        <div
          className="session-bar"
          ref={setSessionBar}
          data-dimmed={activeView === 'workspace' ? undefined : ''}
        />
        <section id="view-panel" aria-label={activeLabel} tabIndex={-1} className="view-panel">
          {activeView === 'hosts' && (
            <HostsView
              query={hostQuery}
              onQueryChange={setHostQuery}
              onCountChange={setHostCount}
              onOpenWorkspace={() => setActiveView('workspace')}
              onSetupVault={() => setShowVaultSetup(true)}
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
            tabBarTarget={sessionBar}
            onActivate={() => setActiveView('workspace')}
            onOpenVault={async () => {
              const state = await window.mterminal.getVaultState();
              setVaultState(state);
              if (!state.configured) setShowVaultSetup(true);
            }}
            toolsPreferences={toolsPreferences}
            onToolsPreferenceChange={changeToolsPreference}
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
          {/* Only loading and failure need attention; "ready" stays for assistive tech. */}
          <span role="status" className={state.status === 'error' ? 'status-error' : ''}>
            {state.status === 'ready' ? (
              <span className="sr-only">Application ready</span>
            ) : (
              <>
                <span className={`status-dot status-dot--${state.status}`} aria-hidden="true" />
                {state.status === 'error'
                  ? 'Application information unavailable. Please restart mTerminal.'
                  : 'Starting application…'}
              </>
            )}
          </span>
          <div className="status-details">
            <span className="vault-status">
              <Icon
                name={vaultState?.configured && !vaultState.locked ? 'unlock' : 'lock'}
                className="vault-status-icon"
              />
              {vaultLabel}
              {vaultState?.configured && !vaultState.locked && (
                <button
                  type="button"
                  className="status-action"
                  aria-label="Lock vault"
                  onClick={() => void window.mterminal.lockVault().catch(() => {})}
                >
                  Lock
                </button>
              )}
              {vaultState && !vaultState.configured && vaultState.available && (
                <button
                  type="button"
                  className="status-action"
                  aria-label="Set up vault"
                  onClick={() => setShowVaultSetup(true)}
                >
                  Set up
                </button>
              )}
            </span>
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
      {(vaultState === null || vaultState.locked || showVaultSetup) && (
        <VaultAccessGate
          configured={vaultState?.configured === true}
          available={vaultState?.available === true}
          onClose={() => setShowVaultSetup(false)}
          onRetry={async () => {
            try {
              setVaultState(await window.mterminal.getVaultState());
            } catch {
              setVaultState({ configured: true, locked: true, available: false });
            }
          }}
          onSetup={async (passphrase) => {
            try {
              await window.mterminal.setupVault(passphrase);
            } finally {
              setVaultState(await window.mterminal.getVaultState());
            }
            setShowVaultSetup(false);
          }}
          onUnlock={async (passphrase) => {
            await window.mterminal.unlockVault(passphrase);
            setVaultState(await window.mterminal.getVaultState());
          }}
          onReset={async () => {
            const reset = await window.mterminal.resetVault();
            if (!reset) return false;
            setVaultState(await window.mterminal.getVaultState());
            setShowVaultSetup(true);
            return true;
          }}
        />
      )}
    </div>
  );
}

function VaultAccessGate({
  configured,
  available,
  onClose,
  onRetry,
  onSetup,
  onUnlock,
  onReset,
}: {
  configured: boolean;
  available: boolean;
  onClose: () => void;
  onRetry: () => Promise<void>;
  onSetup: (passphrase: string) => Promise<void>;
  onUnlock: (passphrase: string) => Promise<void>;
  onReset: () => Promise<boolean>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [passphrase, setPassphrase] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!configured && passphrase !== confirmation) {
      setError('The passphrases do not match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (configured) await onUnlock(passphrase);
      else await onSetup(passphrase);
      setPassphrase('');
      setConfirmation('');
    } catch (cause) {
      setPassphrase('');
      setError(cause instanceof Error ? cause.message : 'Unable to open the local vault.');
    } finally {
      setBusy(false);
    }
  }
  async function reset() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (await onReset()) {
        setPassphrase('');
        setConfirmation('');
        setError(
          'The previous encrypted credential files were preserved. Create a new vault to continue.',
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to reset the local vault.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={ref}
      className="vault-access-dialog"
      aria-labelledby="vault-access-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!configured) onClose();
      }}
    >
      <form onSubmit={(event) => void submit(event)}>
        <h1 id="vault-access-title">{configured ? 'Unlock local vault' : 'Set up local vault'}</h1>
        {!available ? (
          <p role="alert">
            {configured
              ? 'The configured vault or OS keychain is unavailable. Preserve the mTerminal data directory and check the keychain before retrying.'
              : 'OS secure storage is unavailable. Setting up the vault requires a supported operating-system keychain.'}
          </p>
        ) : (
          <>
            <p>
              {configured
                ? 'Enter your vault passphrase. It stays unlocked until mTerminal closes or you lock it, so saved hosts connect in one click.'
                : 'Choose a passphrase of at least 12 characters. Existing saved SSH credentials will be migrated into the encrypted vault.'}
            </p>
            <label>
              Vault passphrase
              <input
                type="password"
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
                minLength={12}
                maxLength={256}
                autoComplete={configured ? 'current-password' : 'new-password'}
                autoFocus
                required
              />
            </label>
            {!configured && (
              <>
                <label>
                  Confirm passphrase
                  <input
                    type="password"
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    minLength={12}
                    maxLength={256}
                    autoComplete="new-password"
                    required
                  />
                </label>
                <p className="vault-warning">
                  If you forget this passphrase, saved passwords, private keys and snippets cannot
                  be recovered. Existing host and identity records are not encrypted by this
                  passphrase.
                </p>
              </>
            )}
          </>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          {!available && (
            <button type="button" disabled={busy} onClick={() => void onRetry()}>
              Retry
            </button>
          )}
          {!configured && (
            <button type="button" disabled={busy} onClick={onClose}>
              Cancel
            </button>
          )}
          {configured && (
            <button type="button" disabled={busy} onClick={() => void reset()}>
              Reset vault…
            </button>
          )}
          {available && (
            <button type="submit" disabled={busy || passphrase.length < 12}>
              {busy ? 'Working…' : configured ? 'Unlock vault' : 'Create vault'}
            </button>
          )}
        </div>
      </form>
    </dialog>
  );
}
