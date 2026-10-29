import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react';
import {
  validateHost,
  validateGroup,
  validateIdentity,
  resolveHost,
  type HostGroup,
  type SavedHost,
  type SshIdentity,
} from '../../../../shared/hosts';
import { EmptyState } from '../../components/EmptyState';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { InstallKeyDialog, PassphraseDialog } from './KeyDialogs';
import {
  ContextMenu,
  menuPositionFor,
  type MenuItem,
  type MenuPosition,
} from '../../components/ContextMenu';
import { badgeHue, breadcrumb, childFolders, initials, visibleHosts } from './host-browser';
import { Icon } from '../../components/Icon';

interface HostsViewProps {
  query: string;
  onQueryChange: (query: string) => void;
  onCountChange: (count: number) => void;
  onOpenWorkspace: () => void;
  onConnect: (host: SavedHost) => void;
}

export function HostsView({
  query,
  onQueryChange,
  onCountChange,
  onOpenWorkspace,
  onConnect,
}: HostsViewProps) {
  const [hosts, setHosts] = useState<SavedHost[]>([]);
  const [groups, setGroups] = useState<HostGroup[]>([]);
  const [identities, setIdentities] = useState<SshIdentity[]>([]);
  const [identityManager, setIdentityManager] = useState(false);
  const [groupFilter, setGroupFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [groupEditor, setGroupEditor] = useState<{ group?: HostGroup; deleting?: boolean } | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<{ host?: SavedHost; deleting?: boolean } | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      window.mterminal.listHosts(),
      window.mterminal.listHostGroups(),
      window.mterminal.listSshIdentities(),
    ])
      .then(([items, savedGroups, savedIdentities]) => {
        if (!cancelled) {
          setHosts(items);
          onCountChange(items.length);
          setGroups(savedGroups);
          setIdentities(savedIdentities);
          setLoading(false);
          setError('');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('Unable to load hosts. Check local storage and retry.');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reload, onCountChange]);
  function connectionUsername(host: SavedHost) {
    const resolved = resolveHost(host, groups);
    return (
      identities.find((identity) => identity.id === resolved.identityId)?.username ||
      resolved.username
    );
  }
  const filtering = query.trim().length > 0 || tagFilter.length > 0;
  const shown = visibleHosts(hosts, groupFilter, {
    query,
    tag: tagFilter,
    searchText: (host) => [
      host.name,
      host.address,
      host.username,
      connectionUsername(host),
      host.groupPath ?? '',
      ...(host.tags ?? []),
    ],
  });
  const folders = filtering ? [] : childFolders(groups, hosts, groupFilter);
  const tags = [...new Set(hosts.flatMap((host) => host.tags ?? []))].sort();
  const refresh = () => {
    setEditor(null);
    setGroupEditor(null);
    setReload((n) => n + 1);
  };
  const [installing, setInstalling] = useState<SavedHost | null>(null);
  const installTarget = installing && installDetails(installing);
  function installDetails(host: SavedHost) {
    const resolved = resolveHost(host, groups);
    const identity = identities.find((item) => item.id === resolved.identityId);
    if (!identity) return null;
    const username = identity.username || resolved.username;
    return { host, identity, target: `${username}@${resolved.address}:${resolved.port}` };
  }
  const [menu, setMenu] = useState<{ host: SavedHost; position: MenuPosition } | null>(null);
  const selectedGroup = groups.find((group) => group.path === groupFilter);
  const empty = hosts.length === 0 && groups.length === 0;

  function clearSearch() {
    onQueryChange('');
    setTagFilter('');
    document.getElementById('host-search')?.focus();
  }

  function hostMenuItems(host: SavedHost): MenuItem[] {
    return [
      { label: 'Connect', onSelect: () => onConnect(host) },
      { label: 'Edit…', onSelect: () => setEditor({ host }) },
      ...(resolveHost(host, groups).identityId
        ? [{ label: 'Install key…', onSelect: () => setInstalling(host) }]
        : []),
      {
        label: 'Delete…',
        danger: true,
        separator: true,
        onSelect: () => setEditor({ host, deleting: true }),
      },
    ];
  }

  return (
    <div className="page-view hosts-view">
      <header className="page-header">
        <div>
          <h1>Hosts</h1>
          <p>All your connections, in one place.</p>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => setIdentityManager(true)}
            disabled={loading || !!error}
          >
            SSH identities ({identities.length})
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setGroupEditor({})}
            disabled={loading || !!error}
          >
            New group
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => setEditor({})}
            disabled={loading || !!error}
          >
            <Icon name="plus" />
            New host
          </button>
        </div>
      </header>
      <div className="host-toolbar">
        <div className="host-search">
          <Icon name="search" />
          <label className="sr-only" htmlFor="host-search">
            Search hosts
          </label>
          <input
            id="host-search"
            type="search"
            placeholder="Search hosts by name, address, user, group or tag…"
            autoComplete="off"
            spellCheck={false}
            maxLength={200}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />
          {query && (
            <button
              type="button"
              className="icon-button"
              aria-label="Clear host search"
              onClick={clearSearch}
            >
              <Icon name="close" />
            </button>
          )}
        </div>
        {tags.length > 0 && (
          <div className="tag-filter" role="group" aria-label="Filter by tag">
            {tags.map((tag) => (
              <button
                key={tag}
                type="button"
                className="tag-chip"
                aria-pressed={tagFilter === tag}
                onClick={() => setTagFilter(tagFilter === tag ? '' : tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>
      <nav className="host-breadcrumb" aria-label="Group">
        <ol>
          <li>
            <button
              type="button"
              aria-current={groupFilter ? undefined : 'location'}
              onClick={() => setGroupFilter('')}
            >
              All hosts
            </button>
          </li>
          {breadcrumb(groupFilter).map((crumb) => (
            <li key={crumb.path}>
              <Icon name="chevron" className="breadcrumb-separator" />
              <button
                type="button"
                aria-current={crumb.path === groupFilter ? 'location' : undefined}
                onClick={() => setGroupFilter(crumb.path)}
              >
                {crumb.name}
              </button>
            </li>
          ))}
        </ol>
        {selectedGroup && (
          <div className="breadcrumb-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => setGroupEditor({ group: selectedGroup })}
            >
              Edit group defaults
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setGroupEditor({ group: selectedGroup, deleting: true })}
            >
              Delete group
            </button>
          </div>
        )}
      </nav>
      <div className="host-body" aria-live="polite">
        {loading ? (
          <p role="status">Loading hosts…</p>
        ) : error ? (
          <div role="alert">
            <p>{error}</p>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setLoading(true);
                setReload((n) => n + 1);
              }}
            >
              Retry
            </button>
          </div>
        ) : empty || (filtering && shown.length === 0) ? (
          <div className="view-body">
            <EmptyState
              icon={filtering ? 'search' : 'hosts'}
              title={filtering ? 'No matching hosts' : 'Your connections start here'}
              description={
                filtering
                  ? 'No saved hosts in this group match the search and tag filter.'
                  : 'Save your SSH connection details here. Open Workspace to use a local terminal.'
              }
              actionLabel={filtering ? 'Clear search' : 'Open workspace'}
              onAction={filtering ? clearSearch : onOpenWorkspace}
            />
          </div>
        ) : (
          <>
            {folders.length > 0 && (
              <section aria-labelledby="groups-heading">
                <h2 id="groups-heading" className="section-label">
                  Groups
                </h2>
                <ul className="card-grid">
                  {folders.map((folder) => (
                    <li key={folder.path}>
                      <button
                        type="button"
                        className="group-card"
                        onClick={() => setGroupFilter(folder.path)}
                      >
                        <Icon name="folder" className="group-card-icon" />
                        <span className="card-text">
                          <strong>{folder.name}</strong>
                          <span>
                            {folder.hostCount} {folder.hostCount === 1 ? 'host' : 'hosts'}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section aria-labelledby="hosts-heading">
              <h2 id="hosts-heading" className="section-label">
                {filtering ? `Results (${shown.length})` : 'Hosts'}
              </h2>
              {shown.length === 0 ? (
                <p className="section-empty">
                  {groupFilter ? 'No hosts directly in this group.' : 'No ungrouped hosts.'}
                </p>
              ) : (
                <ul className="card-grid">
                  {shown.map((host) => {
                    const resolved = resolveHost(host, groups);
                    const username = connectionUsername(host);
                    return (
                      <li
                        key={host.id}
                        className="host-card"
                        onContextMenu={(event) => {
                          event.preventDefault();
                          setMenu({ host, position: { x: event.clientX, y: event.clientY } });
                        }}
                      >
                        <button
                          type="button"
                          className="host-card-main"
                          aria-label={`Connect to ${host.name}`}
                          title={`Connect to ${host.name}`}
                          onClick={() => onConnect(host)}
                        >
                          <span
                            className="host-badge"
                            aria-hidden="true"
                            style={{ '--hue': badgeHue(host.name) } as CSSProperties}
                          >
                            {initials(host.name)}
                          </span>
                          <span className="card-text">
                            <strong>{host.name}</strong>
                            <span className="host-address">
                              {username ? `${username}@` : ''}
                              {resolved.address}:{resolved.port}
                            </span>
                            {filtering && host.groupPath && (
                              <span className="host-group">{host.groupPath}</span>
                            )}
                          </span>
                        </button>
                        {host.tags?.length ? (
                          <ul className="host-tags" aria-label="Tags">
                            {host.tags.map((tag) => (
                              <li key={tag} className="tag-chip tag-chip--static">
                                {tag}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        <div className="host-card-actions">
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={`Edit ${host.name}`}
                            title="Edit"
                            onClick={() => setEditor({ host })}
                          >
                            <Icon name="edit" />
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={`More actions for ${host.name}`}
                            aria-haspopup="menu"
                            title="More actions"
                            onClick={(event) =>
                              setMenu({ host, position: menuPositionFor(event.currentTarget) })
                            }
                          >
                            <Icon name="more" />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}
        {menu && (
          <ContextMenu
            label={`Actions for ${menu.host.name}`}
            position={menu.position}
            items={hostMenuItems(menu.host)}
            onClose={() => setMenu(null)}
          />
        )}
        {editor && (
          <HostDialog
            key={editor.host?.id ?? 'new'}
            host={editor.host}
            groups={groups}
            identities={identities}
            deleting={!!editor.deleting}
            onClose={() => setEditor(null)}
            onSaved={refresh}
          />
        )}
        {groupEditor && (
          <GroupDialog
            group={groupEditor.group}
            identities={identities}
            deleting={!!groupEditor.deleting}
            onClose={() => setGroupEditor(null)}
            onSaved={() => {
              if (groupEditor.deleting) setGroupFilter('');
              refresh();
            }}
          />
        )}
        {installTarget && (
          <InstallKeyDialog
            hostId={installTarget.host.id}
            hostName={installTarget.host.name}
            identityId={installTarget.identity.id}
            identityName={installTarget.identity.name}
            target={installTarget.target}
            onClose={() => setInstalling(null)}
          />
        )}
        {identityManager && (
          <IdentityDialog
            identities={identities}
            onClose={() => setIdentityManager(false)}
            onSaved={() => {
              setIdentityManager(false);
              refresh();
            }}
          />
        )}
      </div>
    </div>
  );
}

function IdentityKeyControls({
  identityId,
  identityName,
}: {
  identityId: string;
  identityName: string;
}) {
  const [saved, setSaved] = useState(false);
  const [available, setAvailable] = useState(false);
  const [error, setError] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [pending, setPending] = useState<'import' | 'generate' | 'delete' | null>(null);
  const refresh = useCallback(
    () =>
      window.mterminal
        .getSshKeyStatus(identityId)
        .then((status) => {
          setSaved(status.saved);
          setAvailable(status.available);
          setPublicKey(status.publicKey ?? '');
        })
        .catch(() => {
          setSaved(false);
          setAvailable(false);
        }),
    [identityId],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function run(operation: 'import' | 'generate' | 'delete', passphrase = '') {
    setError('');
    if (operation === 'import') {
      const key = await window.mterminal.importSshKey(identityId, passphrase);
      // An empty result means the file picker was cancelled; keep the dialog open.
      if (!key) return;
      setPublicKey(key);
    } else if (operation === 'generate')
      setPublicKey(await window.mterminal.generateSshKey(identityId, passphrase));
    else {
      await window.mterminal.deleteSshKey(identityId);
      setPublicKey('');
    }
    setPending(null);
    await refresh();
  }
  return (
    <div className="identity-key">
      <div className="identity-key-row">
        <span className="identity-key-status">
          {saved
            ? 'Managed key saved'
            : available
              ? 'No managed key'
              : 'Secure key storage unavailable'}
        </span>
        <button
          type="button"
          className="secondary-button compact-button"
          disabled={!available}
          onClick={() => setPending('import')}
        >
          Import key
        </button>
        <button
          type="button"
          className="secondary-button compact-button"
          disabled={!available}
          onClick={() => setPending('generate')}
        >
          Generate key
        </button>
        {saved && (
          <button
            type="button"
            className="secondary-button compact-button"
            onClick={() => setPending('delete')}
          >
            Remove key
          </button>
        )}
      </div>
      {publicKey && (
        <div className="key-preview">
          <textarea aria-label="SSH public key" readOnly value={publicKey} />
          <button
            type="button"
            className="secondary-button compact-button"
            onClick={() => void window.mterminal.writeClipboardText(publicKey)}
          >
            Copy public key
          </button>
        </div>
      )}
      {error && (
        <span className="dialog-error" role="alert">
          {error}
        </span>
      )}
      {(pending === 'import' || pending === 'generate') && (
        <PassphraseDialog
          mode={pending}
          identityName={identityName}
          onSubmit={(passphrase) => run(pending, passphrase)}
          onCancel={() => setPending(null)}
        />
      )}
      {pending === 'delete' && (
        <ConfirmDialog
          title={`Remove the saved key for “${identityName}”?`}
          confirmLabel="Remove key"
          danger
          onConfirm={() => run('delete')}
          onCancel={() => setPending(null)}
        >
          <p>
            The private key is deleted from the local vault. Copies already installed on servers
            stay in their authorized_keys files.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function HostDialog({
  host,
  groups,
  identities,
  deleting,
  onClose,
  onSaved,
}: {
  host: SavedHost | undefined;
  groups: HostGroup[];
  identities: SshIdentity[];
  deleting: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
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
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      if (deleting && host) await window.mterminal.deleteHost(host.id);
      else {
        const value = validateHost({
          name: data.get('name'),
          address: data.get('address'),
          port: Number(data.get('port')),
          username: data.get('username'),
          protocol: 'ssh',
          groupPath: data.get('groupPath'),
          tags: String(data.get('tags') ?? '')
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean),
          inheritPort: data.get('inheritPort') === 'on',
          inheritUsername: data.get('inheritUsername') === 'on',
          identityId: String(data.get('identityId') ?? '') || null,
        });
        await window.mterminal.saveHost(value, host?.id);
      }
      onSaved();
    } catch {
      setError('Unable to save changes. Check the fields and local storage, then retry.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={ref}
      className="terminal-dialog"
      aria-labelledby="host-dialog-title"
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
    >
      <form onSubmit={(event) => void submit(event)}>
        <h2 id="host-dialog-title">
          {deleting ? `Delete “${host?.name}”?` : host ? 'Edit host' : 'New host'}
        </h2>
        {deleting ? (
          <p>
            This removes the saved profile for {host?.address}. The remote computer is unaffected.
          </p>
        ) : (
          <>
            <p>
              SSH connection profile. Inherited values use the closest group default. An assigned
              identity supplies the SSH username and preferred authentication method.
            </p>
            <label>
              Group
              <select name="groupPath" defaultValue={host?.groupPath ?? ''}>
                <option value="">Ungrouped</option>
                {groups.map((g) => (
                  <option key={g.path}>{g.path}</option>
                ))}
              </select>
            </label>
            <label>
              SSH identity
              <select name="identityId" defaultValue={host?.identityId ?? ''}>
                <option value="">Use group identity</option>
                {identities.map((identity) => (
                  <option key={identity.id} value={identity.id}>
                    {identity.name} · {identity.username}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tags (comma separated)
              <input name="tags" maxLength={678} defaultValue={host?.tags?.join(', ') ?? ''} />
            </label>
            <label>
              <input
                type="checkbox"
                name="inheritPort"
                defaultChecked={host?.inheritPort ?? false}
              />
              Inherit port from group (fallback 22)
            </label>
            <label>
              <input
                type="checkbox"
                name="inheritUsername"
                defaultChecked={host?.inheritUsername ?? false}
              />
              Inherit username from group (fallback blank)
            </label>
            <label>
              Name
              <input name="name" required maxLength={100} defaultValue={host?.name ?? ''} />
            </label>
            <label>
              Address
              <input
                name="address"
                required
                maxLength={253}
                spellCheck={false}
                placeholder="server.example.com"
                defaultValue={host?.address ?? ''}
              />
            </label>
            <label>
              Port
              <input
                name="port"
                type="number"
                min={1}
                max={65535}
                required
                defaultValue={host?.port ?? 22}
              />
            </label>
            <label>
              Username
              <input
                name="username"
                maxLength={100}
                autoComplete="off"
                spellCheck={false}
                defaultValue={host?.username ?? ''}
              />
            </label>
          </>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className={deleting ? 'danger-button' : 'primary-button'}
            disabled={busy}
          >
            {busy ? 'Saving…' : deleting ? 'Delete host' : 'Save host'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function GroupDialog({
  group,
  identities,
  deleting,
  onClose,
  onSaved,
}: {
  group: HostGroup | undefined;
  identities: SshIdentity[];
  deleting: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
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
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      if (deleting && group) await window.mterminal.deleteHostGroup(group.path);
      else
        await window.mterminal.saveHostGroup(
          validateGroup({
            path: data.get('path'),
            port: data.get('port') ? Number(data.get('port')) : null,
            username: data.get('username') || null,
            identityId: String(data.get('identityId') ?? '') || null,
          }),
        );
      onSaved();
    } catch {
      setError('Unable to save group. Check the fields, parent group and local storage.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={ref}
      className="terminal-dialog"
      aria-labelledby="group-title"
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onClose();
      }}
    >
      <form onSubmit={(e) => void submit(e)}>
        <h2 id="group-title">
          {deleting
            ? `Delete group “${group?.path}”?`
            : group
              ? 'Edit group defaults'
              : 'New group'}
        </h2>
        {deleting ? (
          <p>
            This removes this group and all nested groups. Their hosts move to Ungrouped, retaining
            their effective port, username, identity and tags.
          </p>
        ) : (
          <>
            <label>
              Group path
              <input
                name="path"
                required
                maxLength={200}
                defaultValue={group?.path ?? ''}
                readOnly={!!group}
                placeholder="Work/Production"
              />
            </label>
            <p>Create the parent first. Paths are fixed; use nesting to organize groups.</p>
            <label>
              Default port
              <input
                type="number"
                name="port"
                min={1}
                max={65535}
                defaultValue={group?.port ?? ''}
              />
            </label>
            <label>
              Default username
              <input name="username" maxLength={100} defaultValue={group?.username ?? ''} />
            </label>
            <label>
              Default SSH identity
              <select name="identityId" defaultValue={group?.identityId ?? ''}>
                <option value="">Inherit from parent</option>
                {identities.map((identity) => (
                  <option key={identity.id} value={identity.id}>
                    {identity.name} · {identity.username}
                  </option>
                ))}
              </select>
            </label>
            <p>
              Blank defaults inherit from the parent. A selected identity supplies its username and
              authentication method; hosts can override the identity.
            </p>
          </>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className={deleting ? 'danger-button' : 'primary-button'}
            disabled={busy}
          >
            {busy ? 'Saving…' : deleting ? 'Delete group' : 'Save group'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

const methodLabels: Record<SshIdentity['method'], string> = {
  password: 'Password',
  privateKey: 'Private key',
  'keyboard-interactive': 'Keyboard-interactive',
};

function IdentityDialog({
  identities,
  onClose,
  onSaved,
}: {
  identities: SshIdentity[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [editing, setEditing] = useState<SshIdentity | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !editing) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      const draft = validateIdentity({
        name: data.get('name'),
        username: data.get('username'),
        method: data.get('method'),
      });
      await window.mterminal.saveSshIdentity(draft, editing === 'new' ? undefined : editing.id);
      onSaved();
    } catch {
      setError('Unable to save identity. Check the fields and local storage.');
    } finally {
      setBusy(false);
    }
  }
  const [removing, setRemoving] = useState<SshIdentity | null>(null);
  async function remove(identity: SshIdentity) {
    try {
      await window.mterminal.deleteSshIdentity(identity.id);
    } catch {
      throw new Error('Unable to delete identity. Retry after checking local storage.');
    }
    setRemoving(null);
    onSaved();
  }
  return (
    <dialog ref={ref} className="terminal-dialog identity-dialog" aria-labelledby="identity-title">
      <h2 id="identity-title">SSH identities</h2>
      {!editing ? (
        <>
          <p>
            Reusable username and authentication preferences. Passwords and private keys are kept in
            the encrypted local vault.
          </p>
          <ul className="identity-list">
            {identities.map((identity) => (
              <li className="identity-card" key={identity.id}>
                <div className="identity-card-header">
                  <span className="card-text">
                    <strong>{identity.name}</strong>
                    <span>
                      {identity.username} · {methodLabels[identity.method]}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="secondary-button compact-button"
                    disabled={busy}
                    aria-label={`Edit ${identity.name}`}
                    onClick={() => setEditing(identity)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="secondary-button compact-button"
                    disabled={busy}
                    aria-label={`Delete ${identity.name}`}
                    onClick={() => setRemoving(identity)}
                  >
                    Delete
                  </button>
                </div>
                <IdentityKeyControls identityId={identity.id} identityName={identity.name} />
              </li>
            ))}
          </ul>
          {!identities.length && <p>No identities yet. Create one to reuse SSH login details.</p>}
          {removing && (
            <ConfirmDialog
              title={`Delete SSH identity “${removing.name}”?`}
              confirmLabel="Delete identity"
              danger
              onConfirm={() => remove(removing)}
              onCancel={() => setRemoving(null)}
            >
              <p>
                Hosts and groups using it fall back to their parent group’s identity, or ask for
                login details when connecting. Its saved password and private key are removed.
              </p>
            </ConfirmDialog>
          )}
          {error && <p role="alert">{error}</p>}
          <div className="dialog-actions">
            <button type="button" onClick={onClose}>
              Close
            </button>
            <button type="button" onClick={() => setEditing('new')}>
              New identity
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={(event) => void save(event)}>
          <p>
            {editing === 'new'
              ? 'Create a reusable SSH login profile.'
              : 'Update this reusable SSH login profile.'}{' '}
            Secrets are requested when you connect.
          </p>
          <label>
            Name
            <input
              name="name"
              required
              maxLength={100}
              defaultValue={editing === 'new' ? '' : editing.name}
            />
          </label>
          <label>
            SSH username
            <input
              name="username"
              required
              maxLength={100}
              autoComplete="off"
              defaultValue={editing === 'new' ? '' : editing.username}
            />
          </label>
          <label>
            Preferred authentication method
            <select name="method" defaultValue={editing === 'new' ? 'password' : editing.method}>
              <option value="password">Password (ask at connection)</option>
              <option value="privateKey">
                Private key (use managed key or select at connection)
              </option>
              <option value="keyboard-interactive">Keyboard-interactive</option>
            </select>
          </label>
          {error && <p role="alert">{error}</p>}
          <div className="dialog-actions">
            <button type="button" disabled={busy} onClick={() => setEditing(null)}>
              Back
            </button>
            <button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save identity'}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
