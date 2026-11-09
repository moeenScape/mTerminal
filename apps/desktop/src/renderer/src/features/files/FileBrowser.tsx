import { useCallback, useEffect, useId, useRef, useState, type DragEvent } from 'react';
import { Icon } from '../../components/Icon';
import type {
  DirectoryListing,
  FileEntry,
  FileListRequest,
  FileMutationRequest,
  FileOperation,
} from '../../../../shared/files';
import {
  FILE_DRAG_TYPE,
  fileDropRequest,
  fileSize,
  fileKindLabel,
  symbolicPermissions,
  rememberDirectory,
  type DirectoryHistory,
  visibleFiles,
  type FileSort,
  type FileDrag,
} from './file-browser';
import { ContextMenu, menuPositionFor, type MenuPosition } from '../../components/ContextMenu';
import { FileOperationDialog, type FileAction } from './FileOperationDialog';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import type { TransferRequest } from '../../../../shared/transfers';
import { TransferRecoveryPanel } from './TransferRecoveryPanel';
import { TransferQueueView, useTransfers } from './TransferQueueView';
import { RemoteEditorPanel, useRemoteEdit } from './RemoteEditorPanel';
import { REMOTE_EDIT_MAX_BYTES, type RemoteEditRequest } from '../../../../shared/remote-edit';

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
  const [localDirectory, setLocalDirectory] = useState<string | null>(null);
  const [remoteDirectory, setRemoteDirectory] = useState<{
    sessionId: string | null;
    path: string;
  } | null>(null);
  const onRemoteDirectory = useCallback(
    (path: string) => setRemoteDirectory({ sessionId, path }),
    [sessionId],
  );
  const [drag, setDrag] = useState<FileDrag | null>(null);
  const [recoveryRevision, setRecoveryRevision] = useState(0);
  const transfers = useTransfers();
  const editor = useRemoteEdit();
  const transferContext =
    sessionId && localDirectory && remoteDirectory?.sessionId === sessionId
      ? { sessionId, title: remoteTitle, localDirectory, remoteDirectory: remoteDirectory.path }
      : null;
  const beginDrag = (
    event: DragEvent<HTMLElement>,
    side: 'local' | 'remote',
    entry: FileEntry,
    directory: string,
  ) => {
    if (!transferContext || entry.kind !== 'file') {
      event.preventDefault();
      return;
    }
    const token = crypto.randomUUID();
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(FILE_DRAG_TYPE, token);
    setDrag({ token, side, entry, directory, sessionId: transferContext.sessionId });
  };
  return (
    <section
      className="file-browser"
      aria-label="File browser"
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'none';
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setDrag(null);
      }}
    >
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
      <p className="file-transfer-hint">
        Select a file to Upload / Download, or drag it into the opposite pane&apos;s open folder.
        Double-click folders to open.
      </p>
      <div className="file-browser-panes">
        <DirectoryPane
          side="local"
          title="Local computer"
          sessionId={null}
          onDirectory={setLocalDirectory}
          transferContext={transferContext}
          transferRevision={transfers.revision + recoveryRevision}
          drag={drag}
          onFileDrag={beginDrag}
          onFileDragEnd={() => setDrag(null)}
          canEdit={false}
        />
        {remote ? (
          <DirectoryPane
            side="remote"
            title={remoteTitle}
            sessionId={sessionId}
            onDirectory={onRemoteDirectory}
            transferContext={transferContext}
            transferRevision={transfers.revision + recoveryRevision}
            drag={drag}
            onFileDrag={beginDrag}
            onFileDragEnd={() => setDrag(null)}
            canEdit={editor.ready && !editor.edit}
          />
        ) : (
          <section className="file-pane file-pane-empty" aria-label="Remote files">
            <Icon name="hosts" />
            <h2>Browse a remote host</h2>
            <p>Connect to a saved host from Hosts, then open Files in its SSH tab.</p>
          </section>
        )}
      </div>
      <TransferQueueView jobs={transfers.jobs} error={transfers.error} />
      <TransferRecoveryPanel
        sessionId={remote ? sessionId : null}
        onCleaned={() => setRecoveryRevision((value) => value + 1)}
      />
      <RemoteEditorPanel edit={editor.edit} error={editor.error} />
    </section>
  );
}

function DirectoryPane({
  side,
  title,
  sessionId,
  onDirectory,
  transferContext,
  transferRevision,
  canEdit,
  drag,
  onFileDrag,
  onFileDragEnd,
}: {
  side: 'local' | 'remote';
  title: string;
  sessionId: string | null;
  onDirectory: (path: string) => void;
  transferContext: Omit<TransferRequest, 'direction' | 'name'> | null;
  transferRevision: number;
  canEdit: boolean;
  drag: FileDrag | null;
  onFileDrag: (
    event: DragEvent<HTMLElement>,
    side: 'local' | 'remote',
    entry: FileEntry,
    directory: string,
  ) => void;
  onFileDragEnd: () => void;
}) {
  const id = useId();
  const [dropToken, setDropToken] = useState<string | null>(null);
  const [location, setLocation] = useState({
    path: '',
    revision: 0,
    historyIndex: null as number | null,
  });
  const [history, setHistory] = useState<DirectoryHistory>({ paths: [], index: -1 });
  const [editingPath, setEditingPath] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState<{
    path: string;
    directory: string;
    sessionId: string | null;
  } | null>(null);
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  const [hidden, setHidden] = useState(false);
  const [sort, setSort] = useState<FileSort>('name');
  const [descending, setDescending] = useState(false);
  const [action, setAction] = useState<FileAction | null>(null);
  const [menu, setMenu] = useState<{ entry: FileEntry | null; position: MenuPosition } | null>(
    null,
  );
  const [mutating, setMutating] = useState(false);
  const [notice, setNotice] = useState('');
  const [transfer, setTransfer] = useState<TransferRequest | null>(null);
  const [pendingEdit, setPendingEdit] = useState<RemoteEditRequest | null>(null);
  const loading = useRef<Promise<void>>(Promise.resolve());
  const disconnected = side === 'remote' && !sessionId;
  const blocked = busy || mutating || disconnected;
  const ready =
    !!listing &&
    !blocked &&
    !message &&
    !!transferContext &&
    listing.path ===
      (side === 'local' ? transferContext.localDirectory : transferContext.remoteDirectory);
  const incoming = ready ? fileDropRequest(drag, side, transferContext) : null;
  const dropActive = !!drag && dropToken === drag.token && !!incoming;
  const previewTransfer = (entry: FileEntry) => {
    if (!ready || !transferContext || entry.kind !== 'file') return;
    setMenu(null);
    setTransfer({
      ...transferContext,
      name: entry.name,
      direction: side === 'local' ? 'upload' : 'download',
    });
  };
  useEffect(() => {
    if (side === 'remote' && !sessionId) return;
    let cancelled = false;
    const request: FileListRequest =
      side === 'local'
        ? { side, path: location.path }
        : { side, path: location.path, sessionId: sessionId! };
    loading.current = loading.current
      .then(() => (cancelled ? undefined : window.mterminal.listDirectory(request)))
      .then((value) => {
        if (cancelled || !value) return;
        setListing(value);
        setMenu(null);
        setHistory((current) => rememberDirectory(current, value.path, location.historyIndex));
        onDirectory(value.path);
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
  }, [side, sessionId, location, transferRevision, onDirectory]);
  const navigate = (path: string, historyIndex: number | null = null) => {
    setSelection(null);
    setMenu(null);
    setEditingPath(false);
    setBusy(true);
    setMessage('');
    setLocation((current) => ({ path, revision: current.revision + 1, historyIndex }));
  };
  const entries = visibleFiles(listing?.entries ?? [], hidden, sort, descending, query);
  const selected =
    !blocked &&
    !message &&
    selection?.directory === listing?.path &&
    selection?.sessionId === sessionId
      ? entries.find((entry) => entry.path === selection.path)
      : undefined;
  const select = (entry: FileEntry) => {
    if (listing && !blocked && !message)
      setSelection({ path: entry.path, directory: listing.path, sessionId });
  };
  const changeSort = (field: FileSort) => {
    if (sort === field) setDescending((value) => !value);
    else {
      setSort(field);
      setDescending(false);
    }
  };
  const refresh = () =>
    message ? navigate(location.path, location.historyIndex) : navigate(listing?.path ?? '');
  const menuEntry = menu?.entry;
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
      className={`file-pane${dropActive && incoming ? ' file-pane-drop-target' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const accepts = !!incoming && event.dataTransfer.types.includes(FILE_DRAG_TYPE);
        event.dataTransfer.dropEffect = accepts ? 'copy' : 'none';
        setDropToken(accepts ? drag!.token : null);
      }}
      onDragLeave={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        )
          setDropToken(null);
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setDropToken(null);
        if (incoming && drag && event.dataTransfer.getData(FILE_DRAG_TYPE) === drag.token) {
          setMenu(null);
          setTransfer(incoming);
        }
        onFileDragEnd();
      }}
      aria-label={`${side === 'local' ? 'Local' : 'Remote'} files`}
      aria-busy={busy || mutating}
    >
      {dropActive && incoming && (
        <div className="file-drop-hint" role="status">
          Drop to {incoming.direction === 'upload' ? 'upload' : 'download'} into{' '}
          <code>{listing?.path}</code>. Confirmation required.
        </div>
      )}
      <header className="file-pane-heading">
        <span className={`file-pane-badge ${side}`}>
          <Icon name={side === 'local' ? 'terminal' : 'hosts'} />
        </span>
        <h2>{side === 'local' ? 'Local' : title}</h2>
        <button
          type="button"
          className="pane-filter-button"
          aria-label={`${side} filter files`}
          aria-expanded={filterOpen}
          onClick={() => setFilterOpen((value) => !value)}
        >
          <Icon name="search" />
          Filter{query && <span className="filter-dot" />}
        </button>
        <button
          type="button"
          className="pane-transfer-button"
          title={
            !transferContext
              ? 'Connect through Hosts and load both folders'
              : selected?.kind !== 'file'
                ? 'Select one regular file'
                : 'Copy to the opposite pane’s open folder'
          }
          disabled={!ready || selected?.kind !== 'file'}
          aria-label={
            selected
              ? `${side === 'local' ? 'Upload' : 'Download'} ${selected.name}`
              : `${side === 'local' ? 'Upload' : 'Download'} selected file`
          }
          onClick={() => selected && previewTransfer(selected)}
        >
          {side === 'local' ? 'Upload…' : 'Download…'}
        </button>
        <button
          type="button"
          className="pane-actions-button"
          aria-label={`${side} Actions`}
          aria-haspopup="menu"
          disabled={blocked}
          onClick={(event) =>
            setMenu({ entry: selected ?? null, position: menuPositionFor(event.currentTarget) })
          }
        >
          Actions
          <Icon name="chevron" />
        </button>
      </header>
      <div className="file-navigation">
        <div className="file-navigation-buttons">
          <button
            type="button"
            aria-label="Back"
            title="Previous folder"
            disabled={blocked || history.index <= 0}
            onClick={() => navigate(history.paths[history.index - 1]!, history.index - 1)}
          >
            <Icon name="chevron" className="file-back-icon" />
          </button>
          <button
            type="button"
            aria-label="Forward"
            title="Next folder"
            disabled={blocked || history.index < 0 || history.index >= history.paths.length - 1}
            onClick={() => navigate(history.paths[history.index + 1]!, history.index + 1)}
          >
            <Icon name="chevron" />
          </button>
          <button
            type="button"
            aria-label="Up"
            title="Parent folder"
            disabled={blocked || !listing || listing.path === listing.parent}
            onClick={() => listing && navigate(listing.parent)}
          >
            <Icon name="chevron" className="file-up-icon" />
          </button>
        </div>
        {editingPath ? (
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
              autoFocus
              value={draft}
              maxLength={4096}
              autoComplete="off"
              spellCheck={false}
              disabled={blocked}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setDraft(listing?.path ?? '');
                  setEditingPath(false);
                }
              }}
            />
            <button type="submit" disabled={blocked}>
              Go
            </button>
            <button
              type="button"
              aria-label="Cancel editing location"
              onClick={() => {
                setDraft(listing?.path ?? '');
                setEditingPath(false);
              }}
            >
              <Icon name="close" />
            </button>
          </form>
        ) : (
          <nav className="file-breadcrumbs" aria-label={`${side} folder breadcrumbs`}>
            {listing?.breadcrumbs.map((crumb) => (
              <button
                key={crumb.path}
                type="button"
                disabled={blocked || crumb.path === listing.path}
                onClick={() => navigate(crumb.path)}
                title={crumb.path}
              >
                <Icon name="folder" />
                {crumb.name}
                <Icon name="chevron" />
              </button>
            ))}
          </nav>
        )}
        {!editingPath && (
          <button
            type="button"
            className="file-edit-path"
            aria-label={`${side} edit location`}
            title="Enter a folder path"
            disabled={blocked}
            onClick={() => {
              setDraft(message ? location.path : (listing?.path ?? location.path));
              setEditingPath(true);
            }}
          >
            <Icon name="edit" />
          </button>
        )}
        <button
          type="button"
          aria-label={message ? 'Retry' : 'Refresh'}
          title={message ? 'Retry folder' : 'Refresh folder'}
          disabled={blocked}
          onClick={refresh}
        >
          <span aria-hidden="true">↻</span>
        </button>
      </div>
      {filterOpen && (
        <div className="file-filter">
          <Icon name="search" />
          <input
            autoFocus
            type="search"
            aria-label={`${side} filename filter`}
            placeholder="Filter files by name"
            maxLength={255}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            type="button"
            aria-label={`${side} close filter`}
            onClick={() => {
              setQuery('');
              setFilterOpen(false);
            }}
          >
            <Icon name="close" />
          </button>
        </div>
      )}
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
              {(
                [
                  ['name', 'Name'],
                  ['modified', 'Date Modified'],
                  ['size', 'Size'],
                  ['kind', 'Kind'],
                ] as const
              ).map(([field, label]) => (
                <th
                  key={field}
                  scope="col"
                  aria-sort={sort === field ? (descending ? 'descending' : 'ascending') : 'none'}
                >
                  <button type="button" onClick={() => changeSort(field)}>
                    {label}
                    {sort === field && <span aria-hidden="true">{descending ? ' ↓' : ' ↑'}</span>}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, index) => (
              <tr
                key={entry.path}
                className={selected?.path === entry.path ? 'file-row-selected' : undefined}
                tabIndex={selected ? (selected.path === entry.path ? 0 : -1) : index === 0 ? 0 : -1}
                onFocus={(event) => {
                  if (event.target === event.currentTarget) select(entry);
                }}
                onClick={() => select(entry)}
                onDoubleClick={() => {
                  if (
                    !blocked &&
                    !message &&
                    (entry.kind === 'directory' || entry.kind === 'symlink')
                  )
                    navigate(entry.path);
                }}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget || blocked || message) return;
                  if (
                    event.key === 'Enter' &&
                    (entry.kind === 'directory' || entry.kind === 'symlink')
                  ) {
                    event.preventDefault();
                    navigate(entry.path);
                  } else if (event.key === ' ') {
                    event.preventDefault();
                    select(entry);
                  } else if (
                    event.key === 'ContextMenu' ||
                    (event.shiftKey && event.key === 'F10')
                  ) {
                    event.preventDefault();
                    setMenu({ entry, position: menuPositionFor(event.currentTarget) });
                  } else {
                    const next =
                      event.key === 'ArrowDown'
                        ? Math.min(entries.length - 1, index + 1)
                        : event.key === 'ArrowUp'
                          ? Math.max(0, index - 1)
                          : event.key === 'Home'
                            ? 0
                            : event.key === 'End'
                              ? entries.length - 1
                              : null;
                    if (next !== null) {
                      event.preventDefault();
                      select(entries[next]!);
                      (
                        event.currentTarget.parentElement?.children[next] as HTMLElement | undefined
                      )?.focus();
                    }
                  }
                }}
                draggable={ready && entry.kind === 'file'}
                onDragStart={(event) => {
                  if (!ready || !listing || entry.kind !== 'file') {
                    event.preventDefault();
                    return;
                  }
                  select(entry);
                  setMenu(null);
                  onFileDrag(event, side, entry, listing.path);
                }}
                onDragEnd={onFileDragEnd}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  select(entry);
                  if (!blocked && entry.kind !== 'other')
                    setMenu({ entry, position: { x: event.clientX, y: event.clientY } });
                }}
              >
                <td>
                  <div className="file-name-cell">
                    <button
                      type="button"
                      className={`file-name file-kind-${entry.kind}`}
                      disabled={blocked}
                      aria-label={entry.name}
                      aria-pressed={selected?.path === entry.path}
                      onClick={() => select(entry)}
                    >
                      <Icon
                        name={
                          entry.kind === 'directory' || entry.kind === 'symlink' ? 'folder' : 'file'
                        }
                      />
                      <span className="file-name-text">
                        <strong title={entry.name}>{entry.name}</strong>
                        <small title={`Permissions: ${entry.permissions}`}>
                          {symbolicPermissions(entry.permissions, entry.kind)}
                        </small>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="icon-button file-row-more"
                      tabIndex={selected?.path === entry.path ? 0 : -1}
                      aria-label={`Actions for ${entry.name}`}
                      aria-haspopup="menu"
                      disabled={blocked || !!message || entry.kind === 'other'}
                      onClick={(event) => {
                        select(entry);
                        setMenu({ entry, position: menuPositionFor(event.currentTarget) });
                      }}
                    >
                      <Icon name="more" />
                    </button>
                  </div>
                </td>
                <td className="file-modified">
                  {Number.isFinite(entry.modified)
                    ? new Date(entry.modified).toLocaleString(undefined, {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })
                    : '—'}
                </td>
                <td>{entry.kind === 'directory' ? '—' : fileSize(entry.size)}</td>
                <td className="file-kind-label">{fileKindLabel(entry)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!entries.length && !blocked && !message && (
          <p className="file-empty">
            {listing?.entries.length
              ? query
                ? 'No files match this filter.'
                : 'No visible files. Choose Show hidden files in Actions to see more.'
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
              : `${entries.length} items${selected ? ` · Selected: ${selected.name}` : ''}${query ? ' · Filtered' : ''}${message && listing ? ' · Previous folder shown' : ''}`}
        {listing?.truncated && ' · Showing a partial listing (5,000-entry limit).'}
      </footer>
      {menu && listing && !blocked && (
        <ContextMenu
          label={menuEntry ? `File actions for ${menuEntry.name}` : `${side} file actions`}
          position={menu.position}
          onClose={() => setMenu(null)}
          items={[
            {
              label: 'Open folder',
              disabled:
                !menuEntry ||
                !!message ||
                (menuEntry.kind !== 'directory' && menuEntry.kind !== 'symlink'),
              onSelect: () => menuEntry && navigate(menuEntry.path),
            },
            ...(side === 'remote'
              ? [
                  {
                    label: 'Edit in local editor…',
                    disabled:
                      !canEdit ||
                      !menuEntry ||
                      !!message ||
                      menuEntry.kind !== 'file' ||
                      menuEntry.size > REMOTE_EDIT_MAX_BYTES,
                    onSelect: () => {
                      if (sessionId && menuEntry)
                        setPendingEdit({
                          sessionId,
                          title,
                          remoteDirectory: listing.path,
                          name: menuEntry.name,
                        });
                      setMenu(null);
                    },
                  },
                ]
              : []),
            {
              label: side === 'local' ? 'Upload…' : 'Download…',
              disabled: !ready || menuEntry?.kind !== 'file',
              onSelect: () => menuEntry && previewTransfer(menuEntry),
            },
            {
              label: 'Rename…',
              disabled: !menuEntry || !!message || menuEntry.kind === 'other',
              onSelect: () => {
                if (menuEntry) beginAction('rename', menuEntry);
              },
            },
            {
              label: 'Permissions…',
              disabled:
                !menuEntry ||
                !!message ||
                !listing.canChmod ||
                menuEntry.kind === 'symlink' ||
                menuEntry.kind === 'other',
              onSelect: () => {
                if (menuEntry) beginAction('chmod', menuEntry);
              },
            },
            {
              label: 'Delete…',
              disabled: !menuEntry || !!message || menuEntry.kind === 'other',
              danger: true,
              separator: true,
              onSelect: () => {
                if (menuEntry) beginAction('delete', menuEntry);
              },
            },
            { label: message ? 'Retry' : 'Refresh', separator: true, onSelect: refresh },
            { label: 'New folder', disabled: !!message, onSelect: () => beginAction('mkdir') },
            { label: 'Home', onSelect: () => navigate('') },
            {
              label: hidden ? 'Hide hidden files' : 'Show hidden files',
              onSelect: () => setHidden((value) => !value),
            },
            {
              label: 'Edit location…',
              onSelect: () => {
                setDraft(listing.path);
                setEditingPath(true);
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
      {pendingEdit && (
        <ConfirmDialog
          title="Edit remote text file locally?"
          confirmLabel="Download and open"
          onCancel={() => setPendingEdit(null)}
          onConfirm={async () => {
            if (pendingEdit.sessionId !== sessionId)
              throw new Error('The SSH connection changed. Select the file again.');
            await window.mterminal.startRemoteEdit(pendingEdit);
            setPendingEdit(null);
            setNotice('Preparing remote text editing. See the Remote editor panel.');
          }}
        >
          <p>{pendingEdit.title}</p>
          <p className="file-operation-path">
            {pendingEdit.remoteDirectory}/{pendingEdit.name}
          </p>
          <p>
            Download one UTF-8 text file up to 1 MiB to a private app-data folder and open a
            generated .txt copy in your system&apos;s default text editor. The copy is plaintext and
            is not vault encrypted. Saving does not upload; choose Upload changes explicitly. Copies
            are kept until you discard them.
          </p>
        </ConfirmDialog>
      )}
      {transfer && (
        <ConfirmDialog
          title={`${transfer.direction === 'upload' ? 'Upload' : 'Download'} file?`}
          confirmLabel="Add to queue"
          onCancel={() => setTransfer(null)}
          onConfirm={async () => {
            if (!transferContext || transfer.sessionId !== transferContext.sessionId)
              throw new Error(
                'The SSH connection changed. Close this dialog and select the file again.',
              );
            await window.mterminal.enqueueTransfer(transfer);
            setTransfer(null);
            setNotice(`Queued ${transfer.direction}: ${transfer.name}`);
          }}
        >
          <p>
            {transfer.title} ·{' '}
            {transfer.direction === 'upload' ? 'Local → Remote' : 'Remote → Local'}
          </p>
          <p className="file-operation-path">{transfer.name}</p>
          <p>
            Local folder: <code>{transfer.localDirectory}</code>
          </p>
          <p>
            Remote folder: <code>{transfer.remoteDirectory}</code>
          </p>
          <p>
            The name stays the same. Existing destinations wait for a Replace, Skip or Cancel
            decision in the queue. Only regular files are supported.
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}
