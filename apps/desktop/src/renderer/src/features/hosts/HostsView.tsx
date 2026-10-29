import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
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
import { Icon } from '../../components/Icon';

interface HostsViewProps {
  query: string;
  onQueryChange: (query: string) => void;
  onOpenWorkspace: () => void;
  onConnect: (host: SavedHost) => void;
}

export function HostsView({ query, onQueryChange, onOpenWorkspace, onConnect }: HostsViewProps) {
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
  }, [reload]);
  const filtered = hosts.filter(
    (host) =>
      (!groupFilter ||
        (groupFilter === '/'
          ? !host.groupPath
          : host.groupPath === groupFilter || host.groupPath?.startsWith(groupFilter + '/'))) &&
      (!tagFilter || host.tags?.includes(tagFilter)) &&
      [
        host.name,
        host.address,
        host.username,
        connectionUsername(host),
        host.groupPath ?? '',
        ...(host.tags ?? []),
      ].some((value) => value.toLowerCase().includes(query.trim().toLowerCase())),
  );
  function connectionUsername(host: SavedHost) {
    const resolved = resolveHost(host, groups);
    return (
      identities.find((identity) => identity.id === resolved.identityId)?.username ||
      resolved.username
    );
  }
  const tags = [...new Set(hosts.flatMap((host) => host.tags ?? []))].sort();
  const refresh = () => {
    setEditor(null);
    setGroupEditor(null);
    setReload((n) => n + 1);
  };
  const selectedGroup = groups.find((group) => group.path === groupFilter);
  const searching = query.trim().length > 0 || !!groupFilter || !!tagFilter;

  function clearSearch() {
    onQueryChange('');
    setGroupFilter('');
    setTagFilter('');
    document.getElementById('host-search')?.focus();
  }

  return (
    <div className="page-view">
      <header className="page-header">
        <div>
          <h1>Hosts</h1>
          <p>All your connections, in one place.</p>
        </div>
        <button
          className="primary-button"
          onClick={() => setEditor({})}
          disabled={loading || !!error}
        >
          New host
        </button>
        <div className="host-search">
          <Icon name="search" />
          <label className="sr-only" htmlFor="host-search">
            Search hosts
          </label>
          <input
            id="host-search"
            type="search"
            placeholder="Search hosts…"
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
      </header>
      <div className="host-filters">
        <label>
          Group
          <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
            <option value="">All groups</option>
            <option value="/">Ungrouped</option>
            {groups.map((g) => (
              <option key={g.path} value={g.path}>
                {g.path}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tag
          <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
            <option value="">All tags</option>
            {tags.map((tag) => (
              <option key={tag}>{tag}</option>
            ))}
          </select>
        </label>
        <button onClick={() => setGroupEditor({})} disabled={loading || !!error}>
          New group
        </button>
        <button onClick={() => setIdentityManager(true)} disabled={loading || !!error}>
          SSH identities ({identities.length})
        </button>
        {selectedGroup && (
          <>
            <button onClick={() => setGroupEditor({ group: selectedGroup })}>
              Edit group defaults
            </button>
            <button
              onClick={() =>
                setGroupEditor({
                  group: selectedGroup,
                  deleting: true,
                })
              }
            >
              Delete group
            </button>
          </>
        )}
      </div>
      <div className="list-summary">
        <span>
          All hosts <span className="count">{hosts.length}</span>
        </span>
        <span>
          {hosts.length ? `${filtered.length} shown · SSH profiles` : 'No saved connections'}
        </span>
      </div>
      <div className="view-body" aria-live="polite">
        {loading ? (
          <p role="status">Loading hosts…</p>
        ) : error ? (
          <div role="alert">
            <p>{error}</p>
            <button
              onClick={() => {
                setLoading(true);
                setReload((n) => n + 1);
              }}
            >
              Retry
            </button>
          </div>
        ) : filtered.length ? (
          <ul className="host-list">
            {filtered.map((host) => (
              <li key={host.id} className="host-row">
                <Icon name="hosts" />
                <div className="host-details">
                  <strong>{host.name}</strong>
                  <span>
                    {connectionUsername(host) ? `${connectionUsername(host)}@` : ''}
                    {host.address}:{resolveHost(host, groups).port} · SSH
                  </span>
                  <span>
                    {host.groupPath || 'Ungrouped'}
                    {host.tags?.length ? ` · ${host.tags.join(' · ')}` : ''}
                  </span>
                </div>
                <button onClick={() => onConnect(host)} aria-label={`Connect to ${host.name}`}>
                  Connect
                </button>
                <button onClick={() => setEditor({ host })} aria-label={`Edit ${host.name}`}>
                  Edit
                </button>
                <button
                  onClick={() => setEditor({ host, deleting: true })}
                  aria-label={`Delete ${host.name}`}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={searching ? 'search' : 'hosts'}
            title={searching ? 'No matching hosts' : 'Your connections start here'}
            description={
              searching
                ? `No saved hosts match the current search, group and tag filters. Clear the filters to see all hosts.`
                : 'Save your SSH connection details here. Open Workspace to use a local terminal.'
            }
            actionLabel={searching ? 'Clear search' : 'Open workspace'}
            onAction={searching ? clearSearch : onOpenWorkspace}
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
              setGroupFilter('');
              refresh();
            }}
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

function IdentityKeyControls({ identityId }: { identityId: string }) {
  const [saved, setSaved] = useState(false);
  const [available, setAvailable] = useState(false);
  const [error, setError] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(
    () =>
      window.mterminal
        .getSshKeyStatus(identityId)
        .then((status) => {
          setSaved(status.saved);
          setAvailable(status.available);
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
  async function run(operation: 'import' | 'generate' | 'delete') {
    if (busy) return;
    const passphrase =
      operation === 'delete'
        ? ''
        : window.prompt(
            operation === 'import'
              ? 'Enter the private key passphrase, if it has one (leave blank otherwise).'
              : 'Choose an optional passphrase. Without one, an Ed25519 key is generated; with one, an RSA 2048 key is generated.',
            '',
          );
    if (passphrase === null) return;
    if (
      operation === 'delete' &&
      !window.confirm('Remove the saved SSH private key for this identity?')
    )
      return;
    setBusy(true);
    setError('');
    try {
      if (operation === 'import')
        setPublicKey(await window.mterminal.importSshKey(identityId, passphrase));
      else if (operation === 'generate')
        setPublicKey(await window.mterminal.generateSshKey(identityId, passphrase));
      else await window.mterminal.deleteSshKey(identityId);
      if (operation === 'delete') setPublicKey('');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to manage SSH key.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="host-details">
      <span>
        {saved
          ? 'Managed key saved'
          : available
            ? 'No managed key'
            : 'Secure key storage unavailable'}
      </span>
      <button type="button" disabled={busy || !available} onClick={() => void run('import')}>
        Import key
      </button>
      <button type="button" disabled={busy || !available} onClick={() => void run('generate')}>
        Generate key
      </button>
      {saved && (
        <button type="button" disabled={busy} onClick={() => void run('delete')}>
          Remove key
        </button>
      )}
      {publicKey && (
        <>
          <textarea aria-label="SSH public key" readOnly value={publicKey} />
          <button type="button" onClick={() => void window.mterminal.writeClipboardText(publicKey)}>
            Copy public key
          </button>
        </>
      )}
      {error && <span role="alert">{error}</span>}
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
          <button type="submit" disabled={busy}>
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
          <button disabled={busy} type="submit">
            {busy ? 'Saving…' : deleting ? 'Delete group' : 'Save group'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

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
  async function remove(identity: SshIdentity) {
    if (
      busy ||
      !window.confirm(
        `Delete SSH identity “${identity.name}”? Hosts and groups will fall back to their parent or prompt.`,
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      await window.mterminal.deleteSshIdentity(identity.id);
      onSaved();
    } catch {
      setError('Unable to delete identity. Retry after checking local storage.');
      setBusy(false);
    }
  }
  return (
    <dialog ref={ref} className="terminal-dialog" aria-labelledby="identity-title">
      <h2 id="identity-title">SSH identities</h2>
      {!editing ? (
        <>
          <p>
            Reusable username and authentication preferences. Passwords and private keys are kept in
            the encrypted local vault.
          </p>
          <ul className="host-list">
            {identities.map((identity) => (
              <li className="host-row" key={identity.id}>
                <div className="host-details">
                  <strong>{identity.name}</strong>
                  <span>
                    {identity.username} · {identity.method}
                  </span>
                </div>
                <IdentityKeyControls identityId={identity.id} />
                <button type="button" disabled={busy} onClick={() => setEditing(identity)}>
                  Edit
                </button>
                <button type="button" disabled={busy} onClick={() => void remove(identity)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
          {!identities.length && <p>No identities yet. Create one to reuse SSH login details.</p>}
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
