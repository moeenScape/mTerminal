import { useEffect, useRef, useState } from 'react';
import type { VaultDescriptor } from '../../../../shared/organization-vault.js';
import { logLineOffset, type SessionLogSummary } from '../../../../shared/session-logs.js';
import type {
  SharedLogAction,
  SharedLogNote,
  SharedLogRecord,
  SharedLogSummary,
} from '../../../../shared/shared-logs.js';
import { ConfirmDialog, errorMessage } from '../../components/ConfirmDialog';

export function SharedLogsSettings({
  organizationId,
  vault,
  vaultKey,
}: {
  organizationId: string;
  vault: VaultDescriptor;
  vaultKey: string;
}) {
  const [logs, setLogs] = useState<SharedLogSummary[]>();
  const [local, setLocal] = useState<SessionLogSummary[]>();
  const [localId, setLocalId] = useState('');
  const [recording, setRecording] = useState<SharedLogRecord>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [removing, setRemoving] = useState<SharedLogSummary>();
  const target = { organizationId, vaultId: vault.id, key: vaultKey };
  const canEdit = vault.access !== 'reader';

  async function refresh() {
    const result = await window.mterminal.sharedLogs({ ...target, kind: 'list' });
    const entries = result.logs ?? [];
    setLogs(entries);
    setRecording((current) => (entries.some(({ id }) => id === current?.id) ? current : undefined));
  }

  async function perform(operation: () => Promise<void>) {
    setPending(true);
    setError('');
    setNotice('');
    try {
      await operation();
    } catch (cause) {
      setError(errorMessage(cause, 'Could not update shared logs.'));
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-label="Shared session logs">
      <h4>Shared session logs</h4>
      <p className="field-hint">Shared recordings expire after 30 days.</p>
      <div className="settings-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={pending}
          onClick={() => void perform(refresh)}
        >
          {logs ? 'Refresh shared logs' : 'Show shared logs'}
        </button>
        {canEdit && (
          <button
            type="button"
            className="secondary-button"
            disabled={pending}
            onClick={() =>
              void perform(async () => {
                const completed = (await window.mterminal.listSessionLogs()).filter(
                  (entry) => entry.reason !== 'checkpoint',
                );
                setLocal(completed);
                setLocalId('');
              })
            }
          >
            Choose a local recording
          </button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {canEdit &&
        local &&
        (local.length === 0 ? (
          <p>No completed local recordings are available.</p>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void perform(async () => {
                const result = await window.mterminal.sharedLogs({
                  ...target,
                  kind: 'share',
                  logId: localId,
                });
                if (!result.sharedId) return;
                setNotice('Shared recording is available in this vault.');
                await refresh();
              });
            }}
          >
            <label>
              Local recording
              <select
                value={localId}
                disabled={pending}
                onChange={(event) => setLocalId(event.target.value)}
                required
              >
                <option value="">Choose a recording</option>
                {local.map((log) => (
                  <option key={log.id} value={log.id}>
                    {log.title} · {new Date(log.createdAt).toLocaleString()}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="primary-button" disabled={pending || !localId}>
              Share recording
            </button>
          </form>
        ))}
      {logs &&
        (logs.length === 0 ? (
          <p>No shared recordings are available.</p>
        ) : (
          <ul>
            {logs.map((log) => (
              <li key={log.id}>
                <strong>{log.title}</strong> · Expires {new Date(log.expiresAt).toLocaleString()}
                <div className="settings-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={pending}
                    aria-label={`Open recording ${log.title}`}
                    onClick={() =>
                      void perform(async () => {
                        const result = await window.mterminal.sharedLogs({
                          ...target,
                          kind: 'read',
                          logId: log.id,
                        });
                        setRecording(result.recording);
                      })
                    }
                  >
                    Open recording
                  </button>
                  {vault.access === 'owner' && (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={pending}
                      aria-label={`Remove shared recording ${log.title}`}
                      onClick={() => setRemoving(log)}
                    >
                      Remove shared recording
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ))}
      {recording && (
        <SharedRecording
          key={recording.id}
          recording={recording}
          canEdit={canEdit}
          disabled={pending}
          onAnnotate={async (note, annotationId) => {
            const action: SharedLogAction = {
              ...target,
              kind: 'annotate',
              logId: recording.id,
              note,
              annotationId,
            };
            const result = await window.mterminal.sharedLogs(action);
            setRecording(result.recording);
          }}
        />
      )}
      {removing && (
        <ConfirmDialog
          title="Remove shared recording?"
          confirmLabel="Remove recording"
          danger
          onCancel={() => setRemoving(undefined)}
          onConfirm={async () => {
            await window.mterminal.sharedLogs({ ...target, kind: 'remove', logId: removing.id });
            setLogs((current) => current?.filter(({ id }) => id !== removing.id));
            setRecording((current) => (current?.id === removing.id ? undefined : current));
            setRemoving(undefined);
          }}
        >
          <p>
            This removes “{removing.title}” and its annotations from the shared vault. The original
            device keeps its local recording.
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}

function SharedRecording({
  recording,
  canEdit,
  disabled,
  onAnnotate,
}: {
  recording: SharedLogRecord;
  canEdit: boolean;
  disabled: boolean;
  onAnnotate: (note: SharedLogNote, annotationId: string) => Promise<void>;
}) {
  const [kind, setKind] = useState<SharedLogNote['kind']>('comment');
  const [line, setLine] = useState(1);
  const [text, setText] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [markedLine, setMarkedLine] = useState<number>();
  const highlight = useRef<HTMLElement>(null);
  const retry = useRef<{ note: string; id: string }>(undefined);

  useEffect(() => {
    if (markedLine !== undefined) highlight.current?.scrollIntoView({ block: 'nearest' });
  }, [markedLine]);

  const start = markedLine === undefined ? undefined : logLineOffset(recording.text, markedLine);
  const newline = start === undefined ? -1 : recording.text.indexOf('\n', start);
  const end = newline === -1 ? recording.text.length : newline;

  return (
    <section aria-label={`Recording ${recording.title}`}>
      <h4>{recording.title}</h4>
      <p>Recorded {new Date(recording.recordedAt).toLocaleString()}</p>
      <pre className="shared-log-output" tabIndex={0} aria-label="Shared recording output">
        {start === undefined ? (
          recording.text
        ) : (
          <>
            {recording.text.slice(0, start)}
            <mark ref={highlight}>{recording.text.slice(start, end) || ' '}</mark>
            {recording.text.slice(end)}
          </>
        )}
      </pre>
      <h4>Bookmarks and comments</h4>
      {recording.annotations.length === 0 && <p>No annotations yet.</p>}
      {recording.annotations.length > 0 && (
        <ul>
          {recording.annotations.map((note) => (
            <li key={note.id}>
              {note.kind === 'bookmark' && (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    if (markedLine === note.line)
                      highlight.current?.scrollIntoView({ block: 'nearest' });
                    else setMarkedLine(note.line);
                  }}
                >
                  Line {note.line}
                </button>
              )}{' '}
              {note.text} · {note.author} · {new Date(note.createdAt).toLocaleString()}
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert">{error}</p>}
      {canEdit && (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setWorking(true);
            setError('');
            try {
              const note: SharedLogNote =
                kind === 'comment'
                  ? { kind, text: text.trim() }
                  : { kind, text: text.trim(), line };
              const identity = JSON.stringify(note);
              if (!retry.current || retry.current.note !== identity)
                retry.current = { note: identity, id: crypto.randomUUID() };
              await onAnnotate(note, retry.current.id);
              retry.current = undefined;
              setText('');
            } catch (cause) {
              setError(errorMessage(cause, 'Could not add the annotation.'));
            } finally {
              setWorking(false);
            }
          }}
        >
          <label>
            Annotation type
            <select
              value={kind}
              disabled={disabled || working}
              onChange={(event) =>
                setKind(event.target.value === 'bookmark' ? 'bookmark' : 'comment')
              }
            >
              <option value="comment">Comment</option>
              <option value="bookmark">Bookmark</option>
            </select>
          </label>
          {kind === 'bookmark' && (
            <label>
              Line number
              <input
                type="number"
                min={1}
                step={1}
                value={line}
                onChange={(event) => setLine(Number(event.target.value))}
                disabled={disabled || working}
                required
              />
            </label>
          )}
          <label>
            {kind === 'comment' ? 'Comment' : 'Bookmark label'}
            <input
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={kind === 'comment' ? 512 : 256}
              required={kind === 'comment'}
              disabled={disabled || working}
            />
          </label>
          <button
            className="primary-button"
            type="submit"
            disabled={disabled || working || (kind === 'comment' && !text.trim())}
          >
            {kind === 'bookmark' ? 'Add bookmark' : 'Add comment'}
          </button>
        </form>
      )}
    </section>
  );
}
