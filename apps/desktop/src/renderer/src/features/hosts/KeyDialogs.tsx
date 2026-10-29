import { useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { errorMessage, useModalDialog } from '../../components/ConfirmDialog';

/**
 * Asks for an optional private-key passphrase before importing or generating a key.
 * Generation asks for the passphrase twice so a typo cannot lock the key.
 */
export function PassphraseDialog({
  mode,
  identityName,
  onSubmit,
  onCancel,
}: {
  mode: 'import' | 'generate';
  identityName: string;
  onSubmit: (passphrase: string) => Promise<void>;
  onCancel: () => void;
}) {
  const ref = useModalDialog();
  const [passphrase, setPassphrase] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generating = mode === 'generate';
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (generating && passphrase && passphrase !== confirmation) {
      setError('The passphrases do not match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onSubmit(passphrase);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to save the SSH key.'));
      setBusy(false);
    }
  }
  // Rendered under <body> so styles of the identity list cannot leak in.
  return createPortal(
    <dialog
      ref={ref}
      className="terminal-dialog"
      aria-labelledby="passphrase-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <form onSubmit={(event) => void submit(event)}>
        <h2 id="passphrase-dialog-title">
          {generating ? 'Generate SSH key' : 'Import SSH key'} for “{identityName}”
        </h2>
        <p>
          {generating
            ? 'Without a passphrase, an Ed25519 key is generated. With a passphrase, an RSA 2048 key is generated.'
            : 'Enter the passphrase if the private key is encrypted, or leave it blank. You will choose the key file next.'}
        </p>
        <label>
          {generating ? 'Passphrase (optional)' : 'Private key passphrase'}
          <input
            type="password"
            value={passphrase}
            maxLength={4096}
            autoComplete={generating ? 'new-password' : 'off'}
            autoFocus
            onChange={(event) => setPassphrase(event.target.value)}
          />
        </label>
        {generating && passphrase && (
          <label>
            Confirm passphrase
            <input
              type="password"
              value={confirmation}
              maxLength={4096}
              autoComplete="new-password"
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
        )}
        {error && (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" disabled={busy}>
            {busy ? 'Working…' : generating ? 'Generate key' : 'Choose key file…'}
          </button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}

type InstallState =
  | { phase: 'loading' }
  | { phase: 'unavailable'; message: string }
  | { phase: 'ready'; publicKey: string; needsPassword: boolean }
  | { phase: 'done' };

/**
 * Shows exactly which key goes to which account before installing it into
 * ~/.ssh/authorized_keys, and reports the outcome in place.
 */
export function InstallKeyDialog({
  hostId,
  hostName,
  identityId,
  identityName,
  target,
  onClose,
}: {
  hostId: string;
  hostName: string;
  identityId: string;
  identityName: string;
  /** user@address:port shown to the user. */
  target: string;
  onClose: () => void;
}) {
  const ref = useModalDialog();
  const [state, setState] = useState<InstallState>({ phase: 'loading' });
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      window.mterminal.getSshKeyStatus(identityId),
      window.mterminal.getSshPasswordStatus(identityId),
    ])
      .then(([key, saved]) => {
        if (cancelled) return;
        if (!key.saved || !key.publicKey)
          setState({
            phase: 'unavailable',
            message: `“${identityName}” has no managed key. Import or generate one in SSH identities first.`,
          });
        else
          setState({
            phase: 'ready',
            publicKey: key.publicKey,
            needsPassword: !(saved.available && saved.saved),
          });
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setState({
            phase: 'unavailable',
            message: errorMessage(
              cause,
              'Unable to read the saved key. Unlock the vault and retry.',
            ),
          });
      });
    return () => {
      cancelled = true;
    };
  }, [identityId, identityName]);

  async function install(event: FormEvent) {
    event.preventDefault();
    if (busy || state.phase !== 'ready') return;
    setBusy(true);
    setError('');
    try {
      await window.mterminal.installSshPublicKey(hostId, state.needsPassword ? password : '');
      setPassword('');
      setState({ phase: 'done' });
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to install the public key.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      className="terminal-dialog install-key-dialog"
      aria-labelledby="install-key-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form onSubmit={(event) => void install(event)}>
        <h2 id="install-key-title">Install key on “{hostName}”</h2>
        <dl className="detail-list">
          <div>
            <dt>Account</dt>
            <dd>{target}</dd>
          </div>
          <div>
            <dt>Identity</dt>
            <dd>{identityName}</dd>
          </div>
        </dl>
        {state.phase === 'loading' && <p role="status">Reading the saved key…</p>}
        {state.phase === 'unavailable' && <p role="alert">{state.message}</p>}
        {state.phase === 'ready' && (
          <>
            <div className="key-preview">
              <textarea aria-label="Public key to install" readOnly value={state.publicKey} />
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  void window.mterminal
                    .writeClipboardText(state.publicKey)
                    .then(() => setCopied(true))
                    .catch(() => {})
                }
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="dialog-note">
              The key is appended to ~/.ssh/authorized_keys. Existing entries are kept, and
              permissions are set to 700 for ~/.ssh and 600 for authorized_keys.
            </p>
            {state.needsPassword && (
              <label>
                SSH password for {target.replace(/:\d+$/, '')}
                <input
                  type="password"
                  value={password}
                  autoComplete="off"
                  autoFocus
                  required
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
            )}
          </>
        )}
        {state.phase === 'done' && (
          <p className="dialog-success" role="status">
            Public key installed for {target.replace(/:\d+$/, '')}.
          </p>
        )}
        {error && (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          {state.phase === 'done' || state.phase === 'unavailable' ? (
            <button type="button" className="primary-button" autoFocus onClick={onClose}>
              Close
            </button>
          ) : (
            <>
              <button type="button" disabled={busy} onClick={onClose}>
                Cancel
              </button>
              <button type="submit" disabled={busy || state.phase !== 'ready'}>
                {busy ? 'Installing…' : 'Install key'}
              </button>
            </>
          )}
        </div>
      </form>
    </dialog>
  );
}
