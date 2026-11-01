import { useEffect, useId, useState } from 'react';
import { Icon } from '../../components/Icon';
import type {
  DirectoryListing,
  FileEntry,
  FileListRequest,
  FileMutationRequest,
  FileOperation,
} from '../../../../shared/files';
import { fileSize, visibleFiles, type FileSort } from './file-browser';
import { ContextMenu, menuPositionFor, type MenuPosition } from '../../components/ContextMenu';
import { FileOperationDialog, type FileAction } from './FileOperationDialog';

export function FileBrowser({
  sessionId,
  remoteTitle,
  remote,
  onClose,
}: {
  sessionId: string | null;
  remoteTitle: string;
  remote: boolean;
  onClose: () => void;
}) {
  return (
    <section className="file-browser" aria-label="File browser">
      <header className="file-browser-header">
        <div>
          <Icon name="folder" />
          <strong>Files</strong>
          <span>Local / SFTP</span>
        </div>
        <button type="button" className="secondary-button" onClick={onClose}>
          Back to terminal
        </button>
      </header>
      <div className="file-browser-panes">
        <DirectoryPane side="local" title="Local computer" sessionId={null} />
        {remote ? (
          <DirectoryPane side="remote" title={remoteTitle} sessionId={sessionId} />
        ) : (
          <section className="file-pane file-pane-empty" aria-label="Remote files">
            <Icon name="hosts" />
            <h2>Browse a remote host</h2>
            <p>Connect to a saved host from Hosts, then open Files in its SSH tab.</p>
          </section>
        )}
      </div>
    </section>
  );
}

function DirectoryPane({
  side,
  title,
  sessionId,
}: {
  side: 'local' | 'remote';
  title: string;
  sessionId: string | null;
}) {
  const id = useId();
  const [location, setLocation] = useState({ path: '', revision: 0 });
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  const [hidden, setHidden] = useState(false);
  const [sort, setSort] = useState<FileSort>('name');
  const [descending, setDescending] = useState(false);
  const [action, setAction] = useState<FileAction | null>(null);
  const [menu, setMenu] = useState<{ entry: FileEntry; position: MenuPosition } | null>(null);
  const [mutating, setMutating] = useState(false);
  const [notice, setNotice] = useState('');
  const disconnected = side === 'remote' && !sessionId;
  const blocked = busy || mutating || disconnected;
  useEffect(() => {
    if (side === 'remote' && !sessionId) return;
    let cancelled = false;
    const request: FileListRequest =
      side === 'local'
        ? { side, path: location.path }
        : { side, path: location.path, sessionId: sessionId! };
    void window.mterminal
      .listDirectory(request)
      .then((value) => {
        if (cancelled) return;
        setListing(value);
        setDraft(value.path);
        setMessage('');
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setMessage(error instanceof Error ? error.message : 'Unable to read this folder.');
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [side, sessionId, location]);
  const navigate = (path: string) => {
    setBusy(true);
    setMessage('');
    setLocation((current) => ({ path, revision: current.revision + 1 }));
  };
  const entries = visibleFiles(listing?.entries ?? [], hidden, sort, descending);
  const beginAction = (type: FileOperation['action'], entry?: FileEntry) => {
    if (!listing || blocked) return;
    setAction({ action: type, path: listing.path, entry, sessionId });
    setMenu(null);
  };
  const perform = async (operation: FileOperation) => {
    if (!action || !listing || blocked)
      throw new Error('Wait for the folder or reconnect before making changes.');
    if (side === 'remote' && action.sessionId !== sessionId)
      throw new Error('The SSH connection changed. Close this dialog and reopen the action.');
    setMutating(true);
    setNotice('');
    const request: FileMutationRequest =
      side === 'local'
        ? { side, path: action.path, operation }
        : { side, path: action.path, sessionId: sessionId!, operation };
    try {
      await window.mterminal.mutateDirectory(request);
      setNotice(
        `${operation.action === 'mkdir' ? 'Created folder' : operation.action === 'rename' ? 'Renamed item' : operation.action === 'delete' ? 'Deleted item' : 'Changed permissions'}: ${operation.name}${operation.action === 'rename' ? ` → ${operation.newName}` : ''}`,
      );
    } catch (error) {
      setNotice(
        `${operation.action}: ${action.entry?.path ?? `${action.path} / ${operation.name}`}${operation.action === 'rename' ? ` → ${operation.newName}` : ''}. ` +
          (error instanceof Error
            ? error.message
            : 'The file operation failed. Refresh before retrying.'),
      );
    } finally {
      setAction(null);
      setMutating(false);
      navigate(action.path);
    }
  };
  return (
    <section
      className="file-pane"
      aria-label={`${side === 'local' ? 'Local' : 'Remote'} files`}
      aria-busy={busy || mutating}
    >
      <header className="file-pane-heading">
        <Icon name={side === 'local' ? 'terminal' : 'hosts'} />
        <h2>{title}</h2>
        <span>{side === 'local' ? 'LOCAL' : 'SFTP'}</span>
      </header>
      <nav className="file-breadcrumbs" aria-label={`${side} folder breadcrumbs`}>
        {listing?.breadcrumbs.map((crumb) => (
          <button
            key={crumb.path}
            type="button"
            disabled={blocked || crumb.path === listing.path}
            onClick={() => navigate(crumb.path)}
            title={crumb.path}
          >
            {crumb.name}
          </button>
        ))}
      </nav>
      <form
        className="file-path"
        onSubmit={(event) => {
          event.preventDefault();
          navigate(draft);
        }}
      >
        <label className="sr-only" htmlFor={`${id}-path`}>
          {side} folder path
        </label>
        <input
          id={`${id}-path`}
          value={draft}
          maxLength={4096}
          autoComplete="off"
          spellCheck={false}
          disabled={blocked}
          placeholder={side === 'local' ? 'Home folder' : 'Remote home folder'}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" disabled={blocked}>
          Go
        </button>
      </form>
      <div className="file-pane-controls">
        <button
          type="button"
          disabled={blocked || !listing || listing.path === listing.parent}
          onClick={() => listing && navigate(listing.parent)}
        >
          Up
        </button>
        <button
          type="button"
          disabled={blocked}
          onClick={() => navigate(message ? location.path : (listing?.path ?? ''))}
        >
          {message ? 'Retry' : 'Refresh'}
        </button>
        <button type="button" disabled={blocked} onClick={() => navigate('')}>
          Home
        </button>
        <button type="button" disabled={blocked || !listing} onClick={() => beginAction('mkdir')}>
          New folder
        </button>
        <label>
          <input
            type="checkbox"
            checked={hidden}
            onChange={(event) => setHidden(event.target.checked)}
          />{' '}
          Hidden files
        </label>
      </div>
      <div className="file-sort">
        <label htmlFor={`${id}-sort`}>Sort</label>
        <select
          id={`${id}-sort`}
          value={sort}
          onChange={(event) => setSort(event.target.value as FileSort)}
        >
          <option value="name">Name</option>
          <option value="size">Size</option>
          <option value="modified">Modified</option>
        </select>
        <button
          type="button"
          aria-label={`${side} sort descending`}
          aria-pressed={descending}
          onClick={() => setDescending((value) => !value)}
        >
          {descending ? 'Descending' : 'Ascending'}
        </button>
      </div>
      {message && (
        <p className="file-error" role="alert">
          {message}
        </p>
      )}
      {disconnected && (
        <p className="file-error" role="alert">
          SSH disconnected. Reconnect the terminal to browse or change remote files.
        </p>
      )}
      {notice && (
        <p className="file-operation-notice" role="status">
          {notice}
        </p>
      )}
      <div className="file-table-scroll">
        <table className="file-table">
          <caption className="sr-only">{side} directory entries</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Size</th>
              <th scope="col">Permissions</th>
              <th scope="col">Modified</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.path}>
                <td>
                  {entry.kind === 'directory' || entry.kind === 'symlink' ? (
                    <button
                      type="button"
                      className="file-name"
                      disabled={blocked}
                      title={
                        entry.kind === 'symlink'
                          ? `${entry.name} — symbolic link; open to browse its directory target`
                          : entry.name
                      }
                      onClick={() => navigate(entry.path)}
                    >
                      <Icon name="folder" />
                      <span>{entry.name}</span>
                      {entry.kind === 'symlink' && <small>link</small>}
                    </button>
                  ) : (
                    <span className="file-name" title={entry.name}>
                      <Icon name="file" />
                      <span>{entry.name}</span>
                      {entry.kind === 'other' && <small>special</small>}
                    </span>
                  )}
                </td>
                <td>{entry.kind === 'directory' ? '—' : fileSize(entry.size)}</td>
                <td>
                  <code>{entry.permissions}</code>
                </td>
                <td>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Actions for ${entry.name}`}
                    aria-haspopup="menu"
                    disabled={blocked || entry.kind === 'other'}
                    onClick={(event) =>
                      setMenu({ entry, position: menuPositionFor(event.currentTarget) })
                    }
                  >
                    <Icon name="more" />
                  </button>
                </td>
                <td>
                  {Number.isFinite(entry.modified)
                    ? new Date(entry.modified).toLocaleString()
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!entries.length && !blocked && !message && (
          <p className="file-empty">
            {listing?.entries.length
              ? 'No visible files. Enable Hidden files to see more.'
              : 'This folder is empty.'}
          </p>
        )}
      </div>
      <footer className="file-pane-footer" role="status">
        {disconnected
          ? 'Disconnected'
          : mutating
            ? 'Applying change…'
            : busy
              ? 'Loading folder…'
              : `${entries.length} items${message && listing ? ' · Previous folder shown' : ''}`}
        {listing?.truncated && ' · Showing a partial listing (5,000-entry limit).'}
      </footer>
      {menu && listing && !blocked && (
        <ContextMenu
          label={`File actions for ${menu.entry.name}`}
          position={menu.position}
          onClose={() => setMenu(null)}
          items={[
            {
              label: 'Rename…',
              onSelect: () => {
                beginAction('rename', menu.entry);
              },
            },
            {
              label: 'Permissions…',
              disabled: !listing.canChmod || menu.entry.kind === 'symlink',
              onSelect: () => {
                beginAction('chmod', menu.entry);
              },
            },
            {
              label: 'Delete…',
              danger: true,
              separator: true,
              onSelect: () => {
                beginAction('delete', menu.entry);
              },
            },
          ]}
        />
      )}
      {action && (
        <FileOperationDialog
          action={action}
          scope={`${side === 'local' ? 'Local computer' : `Remote: ${title}`} · ${action.path}`}
          onCancel={() => setAction(null)}
          onConfirm={perform}
        />
      )}
    </section>
  );
}
