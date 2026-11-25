import { useEffect, useState } from 'react';
import type { VaultDescriptor } from '../../../../shared/organization-vault.js';
import { errorMessage } from '../../components/ConfirmDialog';

import { LIVE_INPUT_CHARS, type LiveTypingGrant } from '../../../../shared/live-share.js';

export function LiveTerminalSettings({
  organizationId,
  vault,
}: {
  organizationId: string;
  vault: VaultDescriptor;
}) {
  const [sessions, setSessions] = useState<{ id: string; label: string }[]>();
  const [terminalId, setTerminalId] = useState('');
  const [email, setEmail] = useState('');
  const [invitation, setInvitation] = useState('');
  const [input, setInput] = useState('');
  const [watching, setWatching] = useState('');
  const [output, setOutput] = useState('');
  const [typing, setTyping] = useState<LiveTypingGrant | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(
    () =>
      window.mterminal.onLiveTerminalChanged((state) => {
        if (!state.active) setInvitation('');
      }),
    [],
  );

  useEffect(() => {
    if (!watching) return;
    let active = true;
    let cursor = 0;
    let lease: string | undefined;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await window.mterminal.liveTerminal({
          kind: 'view',
          invitation: watching,
          after: cursor,
        });
        if (!active) return;
        cursor = next.cursor ?? cursor;
        const previousLease = lease;
        lease = next.typing?.lease;
        setTyping(next.typing ?? null);
        if (lease !== previousLease) setDraft('');
        if (next.output) setOutput((previous) => (previous + next.output).slice(-65536));
        timer = setTimeout(() => void poll(), 750);
      } catch (cause) {
        if (!active) return;
        setWatching('');
        setOutput('');
        setTyping(null);
        setDraft('');
        setError(errorMessage(cause, 'Live viewing ended.'));
      }
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
      if (lease)
        void window.mterminal
          .liveTerminal({ kind: 'yield', invitation: watching, lease })
          .catch(() => {});
    };
  }, [watching]);

  async function run(operation: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await operation();
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to start live sharing.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Live terminal">
      <h4>Live terminal</h4>
      {vault.access !== 'reader' && (
        <>
          <button
            className="secondary-button"
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setSessions(
                  (await window.mterminal.liveTerminal({ kind: 'sessions' })).sessions ?? [],
                );
                setTerminalId('');
              })
            }
          >
            Choose an open terminal to share
          </button>
          {sessions?.length === 0 && <p>Open a terminal in Workspace first.</p>}
          {sessions && sessions.length > 0 && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  const reply = await window.mterminal.liveTerminal({
                    kind: 'start',
                    organizationId,
                    vaultId: vault.id,
                    email,
                    terminalId,
                  });
                  if (reply.invitation) setInvitation(reply.invitation);
                });
              }}
            >
              <label>
                Terminal
                <select
                  required
                  value={terminalId}
                  disabled={busy}
                  onChange={(event) => setTerminalId(event.target.value)}
                >
                  <option value="">Choose a terminal</option>
                  {sessions.map(({ id, label }) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Viewer’s account email
                <input
                  type="email"
                  required
                  maxLength={254}
                  disabled={busy}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <button
                className="primary-button"
                type="submit"
                disabled={busy || !terminalId || !email.trim()}
              >
                Start live share
              </button>
            </form>
          )}
          {invitation && (
            <div className="settings-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await window.mterminal.writeClipboardText(invitation);
                    setNotice('Invitation copied. Send it privately to the invited teammate.');
                  })
                }
              >
                Copy live invitation
              </button>
            </div>
          )}
        </>
      )}
      {watching ? (
        <>
          <button
            className="secondary-button"
            type="button"
            onClick={() => {
              setWatching('');
              setOutput('');
              setTyping(null);
              setDraft('');
            }}
          >
            Leave live view
          </button>
          <p role="status">{typing ? 'You have typing control' : 'Live view · Read only'}</p>
          {typing && (
            <>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const { lease, next, ready } = typing;
                  if (busy || !ready) return;
                  void run(async () => {
                    await window.mterminal.liveTerminal({
                      kind: 'input',
                      invitation: watching,
                      lease,
                      sequence: next,
                      text: draft,
                    });
                    setDraft('');
                    setTyping((previous) =>
                      previous?.lease === lease && previous.next === next
                        ? { ...previous, ready: false }
                        : previous,
                    );
                  });
                }}
              >
                <label>
                  Terminal input
                  <input
                    maxLength={LIVE_INPUT_CHARS}
                    value={draft}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => setDraft(event.target.value)}
                    disabled={busy || !typing.ready}
                  />
                </label>
                <p className="field-hint">
                  Sending a line also presses Enter in the host’s terminal.
                </p>
                <button className="primary-button" type="submit" disabled={busy || !typing.ready}>
                  Send line
                </button>
              </form>
              <button
                className="secondary-button"
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await window.mterminal.liveTerminal({
                      kind: 'yield',
                      invitation: watching,
                      lease: typing.lease,
                    });
                    setTyping(null);
                    setDraft('');
                  })
                }
              >
                Give control back
              </button>
            </>
          )}
          <pre className="shared-log-output" aria-label="Live output" tabIndex={0}>
            {output || 'Waiting for terminal output…'}
          </pre>
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setError('');
            setOutput('');
            setWatching(input.trim());
            setInput('');
          }}
        >
          <label>
            Live invitation
            <input
              type="password"
              value={input}
              required
              maxLength={120}
              autoComplete="off"
              disabled={busy}
              onChange={(event) => setInput(event.target.value)}
            />
          </label>
          <button className="secondary-button" type="submit" disabled={busy || !input.trim()}>
            Join live view
          </button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
