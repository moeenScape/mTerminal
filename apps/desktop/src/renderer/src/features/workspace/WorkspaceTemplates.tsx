import { useEffect, useState } from 'react';
import { ConfirmDialog, errorMessage, useModalDialog } from '../../components/ConfirmDialog';
import {
  MAX_WORKSPACE_TEMPLATES,
  type WorkspaceTemplate,
  type WorkspaceTemplateDraft,
} from '../../../../shared/workspace-templates';
import type { SavedHost } from '../../../../shared/hosts';
import type { TabsState } from './tabs';
import { captureTemplate } from './templates';
export function WorkspaceTemplates({
  state,
  onOpen,
  onClose,
}: {
  state: TabsState;
  onOpen: (template: WorkspaceTemplateDraft) => Promise<void>;
  onClose: () => void;
}) {
  const ref = useModalDialog();
  const [templates, setTemplates] = useState<WorkspaceTemplate[]>([]);
  const [hosts, setHosts] = useState<SavedHost[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const selected = templates.find((template) => template.id === selectedId);
  const missing = selected?.panes.some(
    (pane) => pane.hostId && !hosts.some((host) => host.id === pane.hostId),
  );
  useEffect(() => {
    let cancelled = false;
    void Promise.all([window.mterminal.listWorkspaceTemplates(), window.mterminal.listHosts()])
      .then(([templates, hosts]) => {
        if (cancelled) return;
        setTemplates(templates);
        setHosts(hosts);
        setSelectedId(templates[0]?.id ?? '');
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(errorMessage(cause, 'Unable to load workspace templates.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  async function save() {
    if (busy || loading) return;
    setBusy(true);
    setError('');
    try {
      if (templates.some((template) => template.name.toLowerCase() === name.trim().toLowerCase()))
        throw new Error('A template with this name already exists. Choose another name.');
      const saved = await window.mterminal.saveWorkspaceTemplate(captureTemplate(state, name));
      setTemplates((previous) => [...previous, saved].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedId(saved.id);
      setName('');
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to save the template.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={ref}
      className="terminal-dialog workspace-template-dialog"
      aria-labelledby="workspace-templates-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy && !deleting) onClose();
      }}
    >
      <h2 id="workspace-templates-title">Workspace templates</h2>
      <p>
        Save pane names, host references, tab order and split sizes. Passwords, terminal output and
        commands are excluded.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label>
          Template name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={64}
            required
            disabled={busy || loading}
            autoComplete="off"
          />
        </label>
        <p className="field-hint">
          Current workspace: {state.tabs.length} panes. Up to {MAX_WORKSPACE_TEMPLATES} templates on
          this device.
        </p>
        <button
          type="submit"
          className="secondary-button"
          disabled={
            busy ||
            loading ||
            !state.tabs.length ||
            !name.trim() ||
            templates.length >= MAX_WORKSPACE_TEMPLATES
          }
        >
          Save new template
        </button>
      </form>
      {loading ? (
        <p role="status">Loading templates…</p>
      ) : templates.length === 0 ? (
        <p>No saved templates yet.</p>
      ) : (
        <>
          <label>
            Saved template
            <select
              value={selectedId}
              onChange={(event) => setSelectedId(event.target.value)}
              disabled={busy || deleting}
            >
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>
          {selected && (
            <ul className="template-pane-list" aria-label="Template panes">
              {selected.panes.map((pane) => {
                const host = hosts.find((host) => host.id === pane.hostId);
                return (
                  <li key={pane.id}>
                    <strong>{pane.title}</strong>
                    <span>
                      {pane.hostId
                        ? host
                          ? `${host.name} · ${host.address}:${host.port}`
                          : 'Missing SSH host'
                        : 'Local shell'}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {missing && (
            <p role="alert">
              A referenced SSH host has been deleted. Save a new template with an existing host.
            </p>
          )}
          <p>
            Open layout adds idle panes alongside current sessions. Start or connect each pane
            individually. Previous commands are never replayed.
          </p>
          <div className="dialog-actions">
            <button
              type="button"
              disabled={busy || loading || !selected || missing}
              onClick={async () => {
                if (!selected || busy) return;
                setBusy(true);
                setError('');
                try {
                  await onOpen(selected);
                } catch (cause) {
                  setError(errorMessage(cause, 'Unable to open the layout.'));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Open layout
            </button>
            <button
              type="button"
              className="danger-button"
              disabled={busy || !selected}
              onClick={() => setDeleting(true)}
            >
              Delete template
            </button>
          </div>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="dialog-actions">
        <button type="button" disabled={busy || deleting} onClick={onClose}>
          Close
        </button>
      </div>
      {deleting && selected && (
        <ConfirmDialog
          title={`Delete template “${selected.name}”?`}
          confirmLabel="Delete template"
          danger
          onCancel={() => setDeleting(false)}
          onConfirm={async () => {
            await window.mterminal.deleteWorkspaceTemplate(selected.id);
            const remaining = templates.filter((template) => template.id !== selected.id);
            setTemplates(remaining);
            setSelectedId(remaining[0]?.id ?? '');
            setDeleting(false);
          }}
        >
          <p>Only the saved layout is deleted. Open sessions and saved hosts are kept.</p>
        </ConfirmDialog>
      )}
    </dialog>
  );
}
