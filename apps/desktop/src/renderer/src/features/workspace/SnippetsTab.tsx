import { useEffect, useRef, useState } from 'react';
import { ConfirmDialog, errorMessage, useModalDialog } from '../../components/ConfirmDialog';
import {
  matchingSnippets,
  validateSnippet,
  MAX_SNIPPETS,
  type Snippet,
} from '../../../../shared/snippets';
function SnippetEditor({
  snippet,
  onSaved,
  onCancel,
}: {
  snippet: Snippet | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const ref = useModalDialog();
  const [name, setName] = useState(snippet?.name ?? '');
  const [command, setCommand] = useState(snippet?.command ?? '');
  const [folder, setFolder] = useState(snippet?.folder ?? '');
  const [tags, setTags] = useState(snippet?.tags.join(', ') ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <dialog
      ref={ref}
      className="terminal-dialog snippet-editor"
      aria-labelledby="snippet-editor-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError('');
          try {
            const draft = validateSnippet({
              name,
              command,
              folder: folder.trim(),
              tags: tags
                .split(',')
                .map((tag) => tag.trim())
                .filter(Boolean),
            });
            await window.mterminal.saveSnippet(draft, snippet?.id);
            onSaved();
          } catch (cause) {
            setError(errorMessage(cause, 'Unable to save the snippet.'));
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 id="snippet-editor-title">{snippet ? 'Edit snippet' : 'New snippet'}</h2>
        <label>
          Snippet name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            required
            autoFocus
            disabled={busy}
          />
        </label>
        <label>
          Command
          <textarea
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            maxLength={4096}
            rows={7}
            required
            spellCheck={false}
            autoComplete="off"
            disabled={busy}
          />
        </label>
        <label>
          Folder
          <input
            value={folder}
            onChange={(event) => setFolder(event.target.value)}
            maxLength={200}
            placeholder="Deploy/Production"
            disabled={busy}
          />
        </label>
        <label>
          Tags (comma-separated)
          <input
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            maxLength={340}
            disabled={busy}
          />
        </label>
        <p>
          Encrypted in the local vault. Avoid hard-coded credentials; use environment variables or
          managed SSH identities.
        </p>
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="primary-button" disabled={busy}>
            Save snippet
          </button>
        </div>
      </form>
    </dialog>
  );
}
export function SnippetsTab({
  vaultOpen,
  onOpenVault,
  onInsert,
  onRun,
  ready,
}: {
  vaultOpen: boolean;
  onOpenVault: () => Promise<void>;
  onInsert: (command: string) => string | undefined;
  onRun: (snippet: Snippet) => string | undefined;
  ready: boolean;
}) {
  const [entries, setEntries] = useState<Snippet[]>([]);
  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState<{ snippet: Snippet | null } | null>(null);
  const [deleting, setDeleting] = useState<Snippet | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    const changed = window.mterminal.onSnippetsChanged(() => setRevision((value) => value + 1));
    const locked = window.mterminal.onVaultLocked(() => {
      generation.current++;
      setEntries([]);
      setEditing(null);
      setDeleting(null);
      setMessage('Unlock the local vault to use snippets.');
    });
    return () => {
      changed();
      locked();
    };
  }, []);
  useEffect(() => {
    const token = ++generation.current;
    let cancelled = false;
    void (vaultOpen ? window.mterminal.listSnippets() : Promise.resolve([]))
      .then((items) => {
        if (!cancelled && token === generation.current) {
          setEntries(items);
          setFolder((current) =>
            current &&
            !items.some((item) => item.folder === current || item.folder.startsWith(current + '/'))
              ? ''
              : current,
          );
          setLoading(false);
          setMessage('');
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled && token === generation.current) {
          setEntries([]);
          setLoading(false);
          setMessage(errorMessage(cause, 'Unable to load snippets.'));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [vaultOpen, revision]);
  const folders = [
    ...new Set(
      entries.flatMap((entry) =>
        entry.folder
          ? entry.folder.split('/').map((_, index, parts) => parts.slice(0, index + 1).join('/'))
          : [],
      ),
    ),
  ].sort();
  const visible = matchingSnippets(entries, query, folder);
  if (!vaultOpen)
    return (
      <>
        <p className="tool-note">
          Set up or unlock the local vault to save and use encrypted snippets.
        </p>
        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            void onOpenVault().catch((cause: unknown) =>
              setMessage(errorMessage(cause, 'Unable to open the vault.')),
            )
          }
        >
          Set up or unlock vault
        </button>
        {message && <p role="status">{message}</p>}
      </>
    );
  return (
    <>
      <div className="snippet-toolbar">
        <button
          type="button"
          className="secondary-button"
          disabled={entries.length >= MAX_SNIPPETS}
          onClick={() => setEditing({ snippet: null })}
        >
          New snippet
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => setRevision((value) => value + 1)}
        >
          Reload
        </button>
      </div>
      <label className="tools-search">
        <input
          type="search"
          aria-label="Search snippets"
          placeholder="Search snippets"
          value={query}
          maxLength={512}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <label className="snippet-folder">
        Folder
        <select value={folder} onChange={(event) => setFolder(event.target.value)}>
          <option value="">All folders</option>
          {folders.map((folder) => (
            <option key={folder} value={folder}>
              {folder}
            </option>
          ))}
        </select>
      </label>
      <p className="tool-note">
        Insert adds one line without Enter. Run requires confirmation in this pane. Ensure the
        terminal is at an empty shell prompt.
      </p>
      {loading ? (
        <p role="status">Loading snippets…</p>
      ) : !visible.length ? (
        <p>No matching snippets.</p>
      ) : (
        <ul className="snippet-list" aria-label="Saved snippets">
          {visible.map((snippet) => (
            <li key={snippet.id}>
              <strong>{snippet.name}</strong>
              <span className="snippet-metadata">
                {[snippet.folder, ...snippet.tags].filter(Boolean).join(' · ')}
              </span>
              <pre>{snippet.command}</pre>
              <div className="snippet-actions">
                <button
                  type="button"
                  disabled={!ready || /[\r\n]/.test(snippet.command)}
                  onClick={() =>
                    setMessage(
                      onInsert(snippet.command) ?? 'Snippet inserted. Press Enter to run it.',
                    )
                  }
                >
                  Insert
                </button>
                <button
                  type="button"
                  disabled={!ready}
                  onClick={() => setMessage(onRun(snippet) ?? '')}
                >
                  Run…
                </button>
                <button type="button" onClick={() => setEditing({ snippet })}>
                  Edit
                </button>
                <button type="button" onClick={() => setDeleting(snippet)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {message && (
        <p className="tool-note" role="status">
          {message}
        </p>
      )}
      {editing && (
        <SnippetEditor
          key={editing.snippet?.id ?? 'new'}
          snippet={editing.snippet}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setRevision((value) => value + 1);
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete snippet “${deleting.name}”?`}
          confirmLabel="Delete snippet"
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            await window.mterminal.deleteSnippet(deleting.id);
            setDeleting(null);
            setRevision((value) => value + 1);
          }}
        >
          <p>
            The saved snippet is removed from this device. Already running commands are unaffected.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
