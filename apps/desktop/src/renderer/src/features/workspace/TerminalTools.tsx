import { useCallback, useEffect, useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Icon, type IconName } from '../../components/Icon';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ContextMenu, menuPositionFor, type MenuPosition } from '../../components/ContextMenu';
import type { CommandHistoryEntry } from '../../../../shared/history';
import type { VaultState } from '../../../../shared/vault';
import type { HistoryIntegration } from './useCommandHistory';
import {
  defaultTerminalAppearance,
  terminalFontLabels,
  terminalThemeLabels,
  terminalThemes,
  type TerminalAppearance,
  type TerminalCursor,
  type TerminalFont,
  type TerminalTheme,
} from './appearance';

export type ToolTab = 'autocomplete' | 'history' | 'themes';
const tabs: { id: ToolTab; label: string; icon: IconName }[] = [
  { id: 'autocomplete', label: 'Autocomplete', icon: 'rocket' },
  { id: 'history', label: 'History', icon: 'history' },
  { id: 'themes', label: 'Themes', icon: 'palette' },
];

export interface ToolsPreferences {
  recordHistory: boolean;
  autocomplete: boolean;
}

/** Right-hand terminal tools panel, modelled on Termius: autocomplete, history and themes. */
export function TerminalTools({
  id,
  title,
  tab,
  onTabChange,
  onClose,
  local,
  integration,
  directory,
  onInsert,
  preferences,
  onPreferenceChange,
  appearance,
  applicationTheme,
  onAppearanceChange,
}: {
  id: string;
  title: string;
  tab: ToolTab;
  onTabChange: (tab: ToolTab) => void;
  onClose: () => void;
  local: boolean;
  integration: HistoryIntegration;
  directory: () => string;
  onInsert: (command: string) => string | undefined;
  preferences: ToolsPreferences;
  onPreferenceChange: (patch: Partial<ToolsPreferences>) => Promise<void>;
  appearance: TerminalAppearance;
  applicationTheme: 'dark' | 'light';
  onAppearanceChange: (value: TerminalAppearance) => void;
}) {
  const prefix = useId();
  const [vault, setVault] = useState<VaultState | null>(null);
  const refreshVault = useCallback(() => {
    void window.mterminal
      .getVaultState()
      .then(setVault)
      .catch(() => setVault(null));
  }, []);
  useEffect(() => {
    refreshVault();
    const unsubscribeLocked = window.mterminal.onVaultLocked(refreshVault);
    const unsubscribeChanged = window.mterminal.onHistoryChanged(refreshVault);
    return () => {
      unsubscribeLocked();
      unsubscribeChanged();
    };
  }, [refreshVault]);
  const vaultOpen = !!vault && vault.configured && !vault.locked && vault.available;

  function selectTab(event: KeyboardEvent<HTMLDivElement>) {
    const order = tabs.map((item) => item.id);
    const current = order.indexOf(tab);
    const next =
      event.key === 'ArrowRight'
        ? order[(current + 1) % order.length]
        : event.key === 'ArrowLeft'
          ? order[(current - 1 + order.length) % order.length]
          : event.key === 'Home'
            ? order[0]
            : event.key === 'End'
              ? order[order.length - 1]
              : undefined;
    if (!next) return;
    event.preventDefault();
    onTabChange(next);
    document.getElementById(`${prefix}-${next}`)?.focus();
  }

  return (
    <aside
      className="terminal-tools"
      id={`terminal-tools-${id}`}
      aria-label={`Terminal tools for ${title}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div className="tools-toolbar">
        <div role="tablist" aria-label="Terminal tools" onKeyDown={selectTab}>
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`${prefix}-${item.id}`}
              aria-selected={tab === item.id}
              aria-controls={`${prefix}-panel`}
              tabIndex={tab === item.id ? 0 : -1}
              aria-label={item.label}
              title={item.label}
              onClick={() => onTabChange(item.id)}
            >
              <Icon name={item.icon} />
            </button>
          ))}
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close terminal tools"
          title="Close"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      <div
        role="tabpanel"
        id={`${prefix}-panel`}
        aria-labelledby={`${prefix}-${tab}`}
        className="tools-content"
      >
        {tab === 'autocomplete' && (
          <AutocompleteTab
            local={local}
            integration={integration}
            vault={vault}
            vaultOpen={vaultOpen}
            preferences={preferences}
            onPreferenceChange={onPreferenceChange}
          />
        )}
        {tab === 'history' && (
          <HistoryTab directory={directory} onInsert={onInsert} vaultOpen={vaultOpen} />
        )}
        {tab === 'themes' && (
          <ThemesTab
            value={appearance}
            applicationTheme={applicationTheme}
            onChange={onAppearanceChange}
          />
        )}
      </div>
    </aside>
  );
}

function ToolSetting({
  label,
  badge,
  value,
  options,
  onChange,
}: {
  label: string;
  badge?: string;
  value: boolean;
  options: [string, string];
  onChange: (value: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="tool-setting">
      <label htmlFor={id}>
        {label}
        {badge && <span className="tool-badge">{badge}</span>}
      </label>
      <select
        id={id}
        value={value ? 'on' : 'off'}
        onChange={(event) => onChange(event.target.value === 'on')}
      >
        <option value="on">{options[0]}</option>
        <option value="off">{options[1]}</option>
      </select>
    </div>
  );
}

function AutocompleteTab({
  local,
  integration,
  vault,
  vaultOpen,
  preferences,
  onPreferenceChange,
}: {
  local: boolean;
  integration: HistoryIntegration;
  vault: VaultState | null;
  vaultOpen: boolean;
  preferences: ToolsPreferences;
  onPreferenceChange: (patch: Partial<ToolsPreferences>) => Promise<void>;
}) {
  const [message, setMessage] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const change = (patch: Partial<ToolsPreferences>) => {
    setMessage('');
    onPreferenceChange(patch).catch(() => setMessage('Unable to save the setting. Try again.'));
  };
  const clear = async () => {
    await window.mterminal.clearHistory();
    setConfirmClear(false);
    setMessage('Saved history cleared.');
  };
  const status = !local
    ? 'Suggestions appear in local Bash terminals. History and themes work here too.'
    : integration === 'unsupported'
      ? 'Suggestions need Bash 5. Choose /bin/bash in Settings, then open a new terminal.'
      : integration === 'ready'
        ? preferences.autocomplete
          ? 'Suggestions are active in this terminal.'
          : 'Suggestions are turned off.'
        : 'Waiting for the Bash prompt…';
  const savingNote = !preferences.recordHistory
    ? 'New commands are not saved. Your Bash history file is still used.'
    : !vault?.configured
      ? 'Set up the vault to save new commands. Your Bash history file is still used.'
      : !vaultOpen
        ? 'The vault is locked, so new commands are not saved until you unlock it.'
        : 'New commands are saved, encrypted, for 30 days.';
  return (
    <>
      <ToolSetting
        label="Autocomplete"
        badge="BETA"
        value={preferences.autocomplete}
        options={['Enabled', 'Disabled']}
        onChange={(autocomplete) => change({ autocomplete })}
      />
      <p className="tool-note" role="status">
        {status}
      </p>
      <ToolSetting
        label="Save new commands"
        value={preferences.recordHistory}
        options={['On', 'Off']}
        onChange={(recordHistory) => change({ recordHistory })}
      />
      <p className="tool-note">{savingNote}</p>
      {message && (
        <p className="tool-note" role="status">
          {message}
        </p>
      )}
      <dl className="tool-shortcuts" aria-label="Suggestion shortcuts">
        <div>
          <dt>↑ ↓</dt>
          <dd>Choose a suggestion</dd>
        </div>
        <div>
          <dt>→</dt>
          <dd>Insert it</dd>
        </div>
        <div>
          <dt>Enter</dt>
          <dd>Run the chosen command</dd>
        </div>
        <div>
          <dt>Esc</dt>
          <dd>Hide suggestions</dd>
        </div>
      </dl>
      <p className="tool-note">
        Commands can contain secrets. Commands that start with a space, and ones that look like they
        include a password or token, are never saved or suggested.
      </p>
      <button
        type="button"
        className="secondary-button"
        disabled={!vaultOpen}
        title={vaultOpen ? undefined : 'Unlock the vault to clear saved commands'}
        onClick={() => setConfirmClear(true)}
      >
        Clear saved history
      </button>
      {confirmClear && (
        <ConfirmDialog
          title="Clear saved command history?"
          confirmLabel="Clear history"
          danger
          onConfirm={clear}
          onCancel={() => setConfirmClear(false)}
        >
          <p>
            Removes every command mTerminal has saved in the vault. Your shell&apos;s own history
            file is not changed.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}

function HistoryTab({
  directory,
  onInsert,
  vaultOpen,
}: {
  directory: () => string;
  onInsert: (command: string) => string | undefined;
  vaultOpen: boolean;
}) {
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<CommandHistoryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState('');
  const [revision, setRevision] = useState(0);
  const [menu, setMenu] = useState<{ entry: CommandHistoryEntry; position: MenuPosition } | null>(
    null,
  );
  const [deleting, setDeleting] = useState<CommandHistoryEntry | null>(null);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    const unsubscribeChanged = window.mterminal.onHistoryChanged(refresh);
    const unsubscribeLocked = window.mterminal.onVaultLocked(refresh);
    return () => {
      unsubscribeChanged();
      unsubscribeLocked();
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const pending = setTimeout(() => {
      void window.mterminal
        .searchHistory(query, directory(), 'contains')
        .then((value) => {
          if (cancelled) return;
          setEntries(value);
          setLoaded(true);
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setEntries([]);
          setLoaded(true);
          setMessage(error instanceof Error ? error.message : 'History is unavailable.');
        });
    }, 100);
    return () => {
      cancelled = true;
      clearTimeout(pending);
    };
    // vaultOpen: unlocking adds saved commands to the list.
  }, [query, revision, directory, vaultOpen]);

  const insert = (entry: CommandHistoryEntry) => setMessage(onInsert(entry.command) ?? '');
  const copy = (entry: CommandHistoryEntry) => {
    void window.mterminal
      .writeClipboardText(entry.command)
      .then(() => setMessage('Command copied.'))
      .catch(() => setMessage('Unable to copy the command.'));
  };

  return (
    <>
      <label className="tools-search">
        <Icon name="search" />
        <input
          type="search"
          aria-label="Search command history"
          placeholder="Search"
          value={query}
          maxLength={4096}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {message && (
        <p className="tool-note" role="status">
          {message}
        </p>
      )}
      {entries.length > 0 && (
        <ul className="history-list" aria-label="Commands">
          {entries.map((entry) => (
            <li
              key={entry.id}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({ entry, position: { x: event.clientX, y: event.clientY } });
              }}
            >
              <button
                type="button"
                className="history-command"
                title={`${entry.command}${entry.directory ? `\n${entry.directory}` : ''}\nClick to insert. Right-click for more.`}
                onClick={() => insert(entry)}
                onKeyDown={(event) => {
                  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                    event.preventDefault();
                    setMenu({ entry, position: menuPositionFor(event.currentTarget) });
                  }
                }}
              >
                {entry.command}
              </button>
              <button
                type="button"
                className="history-more"
                aria-label={`More actions for ${entry.command}`}
                aria-haspopup="menu"
                onClick={(event) =>
                  setMenu({ entry, position: menuPositionFor(event.currentTarget) })
                }
              >
                <Icon name="more" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {loaded && !entries.length && (
        <div className="tools-empty">
          <Icon name="history" />
          <p>{query ? 'No matching commands' : 'No commands yet'}</p>
          <small>Commands you run in Bash appear here.</small>
        </div>
      )}
      {menu && (
        <ContextMenu
          label={`Actions for ${menu.entry.command}`}
          position={menu.position}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Insert', onSelect: () => insert(menu.entry) },
            { label: 'Copy', onSelect: () => copy(menu.entry) },
            {
              label: 'Delete…',
              danger: true,
              separator: true,
              disabled: menu.entry.source !== 'saved' || !vaultOpen,
              onSelect: () => setDeleting(menu.entry),
            },
          ]}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete saved command?"
          confirmLabel="Delete"
          danger
          onConfirm={async () => {
            await window.mterminal.deleteHistory(deleting.id);
            setDeleting(null);
          }}
          onCancel={() => setDeleting(null)}
        >
          <p className="key-preview">{deleting.command}</p>
        </ConfirmDialog>
      )}
    </>
  );
}

function ThemesTab({
  value,
  applicationTheme,
  onChange,
}: {
  value: TerminalAppearance;
  applicationTheme: 'dark' | 'light';
  onChange: (value: TerminalAppearance) => void;
}) {
  const id = useId();
  return (
    <div className="themes-tab">
      <fieldset className="theme-list">
        <legend>Theme</legend>
        {(Object.keys(terminalThemeLabels) as TerminalTheme[]).map((theme) => {
          const colours = terminalThemes[theme === 'system' ? applicationTheme : theme];
          return (
            <label key={theme} className="theme-option">
              <input
                type="radio"
                name={`${id}-theme`}
                value={theme}
                checked={value.theme === theme}
                onChange={() => onChange({ ...value, theme })}
              />
              <span
                className="theme-swatch"
                aria-hidden="true"
                style={{ background: colours.background, color: colours.foreground }}
              >
                <span>$ ls</span>
                <span className="theme-dots">
                  {[colours.red, colours.green, colours.yellow, colours.blue, colours.magenta].map(
                    (colour) => (
                      <i key={colour} style={{ background: colour }} />
                    ),
                  )}
                </span>
              </span>
              <span className="theme-name">{terminalThemeLabels[theme]}</span>
            </label>
          );
        })}
      </fieldset>
      <div className="themes-controls">
        <Select
          label="Font"
          value={value.font}
          options={Object.entries(terminalFontLabels)}
          onChange={(font) => onChange({ ...value, font: font as TerminalFont })}
        />
        <Select
          label="Font size"
          value={String(value.fontSize)}
          options={[10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24].map((size) => [
            String(size),
            `${size}px`,
          ])}
          onChange={(size) => onChange({ ...value, fontSize: Number(size) })}
        />
        <Select
          label="Zoom"
          value={String(value.zoom)}
          options={[75, 90, 100, 110, 125, 150].map((zoom) => [String(zoom), `${zoom}%`])}
          onChange={(zoom) => onChange({ ...value, zoom: Number(zoom) })}
        />
        <Select
          label="Cursor"
          value={value.cursor}
          options={[
            ['block', 'Block'],
            ['bar', 'Bar'],
            ['underline', 'Underline'],
          ]}
          onChange={(cursor) => onChange({ ...value, cursor: cursor as TerminalCursor })}
        />
        <label className="tool-check">
          <input
            type="checkbox"
            checked={value.blink}
            onChange={(event) => onChange({ ...value, blink: event.target.checked })}
          />
          Blink cursor
        </label>
      </div>
      <p className="tool-note">Changes apply to this terminal tab for this app session.</p>
      <button
        type="button"
        className="secondary-button"
        onClick={() => onChange(defaultTerminalAppearance)}
      >
        Reset appearance
      </button>
    </div>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}): ReactNode {
  const id = useId();
  return (
    <div className="tool-setting">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([option, text]) => (
          <option key={option} value={option}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );
}
