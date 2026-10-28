import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  validateHost,
  validateGroup,
  resolveHost,
  type HostGroup,
  type SavedHost,
} from '../../../../shared/hosts';
import { EmptyState } from '../../components/EmptyState';
import { Icon } from '../../components/Icon';

interface HostsViewProps {
  query: string;
  onQueryChange: (query: string) => void;
  onOpenWorkspace: () => void;
}

export function HostsView({ query, onQueryChange, onOpenWorkspace }: HostsViewProps) {
  const [hosts, setHosts] = useState<SavedHost[]>([]);
  const [groups, setGroups] = useState<HostGroup[]>([]);
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
    void Promise.all([window.mterminal.listHosts(), window.mterminal.listHostGroups()])
      .then(([items, savedGroups]) => {
        if (!cancelled) {
          setHosts(items);
          setGroups(savedGroups);
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
        resolveHost(host, groups).username,
        host.groupPath ?? '',
        ...(host.tags ?? []),
      ].some((value) => value.toLowerCase().includes(query.trim().toLowerCase())),
  );
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
                    {resolveHost(host, groups).username
                      ? `${resolveHost(host, groups).username}@`
                      : ''}
                    {host.address}:{resolveHost(host, groups).port} · SSH
                  </span>
                  <span>
                    {host.groupPath || 'Ungrouped'}
                    {host.tags?.length ? ` · ${host.tags.join(' · ')}` : ''}
                  </span>
                </div>
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
            deleting={!!editor.deleting}
            onClose={() => setEditor(null)}
            onSaved={refresh}
          />
        )}
        {groupEditor && (
          <GroupDialog
            group={groupEditor.group}
            deleting={!!groupEditor.deleting}
            onClose={() => setGroupEditor(null)}
            onSaved={() => {
              setGroupFilter('');
              refresh();
            }}
          />
        )}
      </div>
    </div>
  );
}

function HostDialog({
  host,
  groups,
  deleting,
  onClose,
  onSaved,
}: {
  host: SavedHost | undefined;
  groups: HostGroup[];
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
            <p>SSH connection profile. Inherited values use the closest group default.</p>
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
  deleting,
  onClose,
  onSaved,
}: {
  group: HostGroup | undefined;
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
            their effective port, username and tags.
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
            <p>Blank defaults inherit from the parent. Hosts can override each setting.</p>
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
