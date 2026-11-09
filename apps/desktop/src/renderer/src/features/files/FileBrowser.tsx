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
        Drag one file to the opposite pane, or use Upload / Download beside a file. Drops use the
        destination pane&apos;s open folder.
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
        onDirectory(value.path);
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
  }, [side, sessionId, location, transferRevision, onDirectory]);
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
              <tr
                key={entry.path}
                draggable={ready && entry.kind === 'file'}
                onDragStart={(event) => {
                  if (!ready || !listing || entry.kind !== 'file') {
                    event.preventDefault();
                    return;
                  }
                  setMenu(null);
                  onFileDrag(event, side, entry, listing.path);
                }}
                onDragEnd={onFileDragEnd}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (!blocked && entry.kind !== 'other')
                    setMenu({ entry, position: { x: event.clientX, y: event.clientY } });
                }}
              >
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
                  {Number.isFinite(entry.modified)
                    ? new Date(entry.modified).toLocaleString()
                    : '—'}
                </td>
                <td className="file-row-actions">
                  {entry.kind === 'file' && (
                    <button
                      type="button"
                      className="file-transfer-button"
                      disabled={!ready}
                      title={
                        ready
                          ? `Copy to the ${side === 'local' ? 'remote' : 'local'} pane's open folder`
                          : 'Connect through Hosts and wait for both folders to load'
                      }
                      aria-label={`${side === 'local' ? 'Upload' : 'Download'} ${entry.name}`}
                      onClick={() => previewTransfer(entry)}
                    >
                      {side === 'local' ? 'Upload…' : 'Download…'}
                    </button>
                  )}
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
            ...(side === 'remote'
              ? [
                  {
                    label: 'Edit in local editor…',
                    disabled:
                      !canEdit ||
                      menu.entry.kind !== 'file' ||
                      menu.entry.size > REMOTE_EDIT_MAX_BYTES,
                    onSelect: () => {
                      if (sessionId)
                        setPendingEdit({
                          sessionId,
                          title,
                          remoteDirectory: listing.path,
                          name: menu.entry.name,
                        });
                      setMenu(null);
                    },
                  },
                ]
              : []),
            {
              label: side === 'local' ? 'Upload…' : 'Download…',
              disabled: !ready || menu.entry.kind !== 'file',
              onSelect: () => previewTransfer(menu.entry),
            },
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
