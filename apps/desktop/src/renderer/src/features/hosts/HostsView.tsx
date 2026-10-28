import { useEffect, useRef, useState, type FormEvent } from 'react';
import { validateHost, type SavedHost } from '../../../../shared/hosts';
import { EmptyState } from '../../components/EmptyState';
import { Icon } from '../../components/Icon';

interface HostsViewProps {
  query: string;
  onQueryChange: (query: string) => void;
  onOpenWorkspace: () => void;
}

export function HostsView({ query, onQueryChange, onOpenWorkspace }: HostsViewProps) {
  const [hosts, setHosts] = useState<SavedHost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<{ host?: SavedHost; deleting?: boolean } | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void window.mterminal
      .listHosts()
      .then((items) => {
        if (!cancelled) {
          setHosts(items);
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
  const filtered = hosts.filter((host) =>
    [host.name, host.address, host.username].some((value) =>
      value.toLowerCase().includes(query.trim().toLowerCase()),
    ),
  );
  const searching = query.trim().length > 0;

  function clearSearch() {
    onQueryChange('');
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
                    {host.username ? `${host.username}@` : ''}
                    {host.address}:{host.port} · SSH
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
                ? `No saved hosts match “${query.trim()}”. Try another search or clear the filter.`
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
            deleting={!!editor.deleting}
            onClose={() => setEditor(null)}
            onSaved={() => {
              setEditor(null);
              setReload((n) => n + 1);
            }}
          />
        )}
      </div>
    </div>
  );
}

function HostDialog({
  host,
  deleting,
  onClose,
  onSaved,
}: {
  host: SavedHost | undefined;
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
            <p>SSH connection profile</p>
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
