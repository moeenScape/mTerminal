import { rememberMissingUsername } from './saved-credentials';
import { resolveHost } from '../../../../shared/hosts';
import { useEffect, useRef, useState } from 'react';
import { validateSshCredentials, type SshCredentials } from '../../../../shared/ssh';
import { ConfirmDialog, errorMessage } from '../../components/ConfirmDialog';

export function SshPrompt({
  title,
  reconnect,
  hostId,
  notice = '',
  onConnect,
  onCancel,
}: {
  title: string;
  reconnect: boolean;
  hostId: string;
  /** Shown at the top, e.g. when a saved password was rejected. */
  notice?: string;
  onConnect: (credentials: SshCredentials) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const active = useRef(true);
  const pendingSubmit = useRef(false);
  const [loadingCredentials, setLoadingCredentials] = useState(true);
  const cancel = () => {
    active.current = false;
    onCancel();
  };
  const [username, setUsername] = useState('');
  const [missingUsername, setMissingUsername] = useState(false);
  const [rememberUsername, setRememberUsername] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [method, setMethod] = useState<'password' | 'privateKey' | 'keyboard-interactive'>(
    'password',
  );
  const [privateKey, setPrivateKey] = useState('');
  const [keyLoading, setKeyLoading] = useState(false);
  const [identityId, setIdentityId] = useState<string | null>(null);
  /** Where a typed password is saved: the host itself, or its shared identity. */
  const [passwordOwner, setPasswordOwner] = useState(hostId);
  const [vaultAvailable, setVaultAvailable] = useState(false);
  const [savedPassword, setSavedPassword] = useState(false);
  const [savedKey, setSavedKey] = useState(false);
  const [useSavedKey, setUseSavedKey] = useState(false);
  const [useSavedPassword, setUseSavedPassword] = useState(false);
  const [rememberPassword, setRememberPassword] = useState(true);
  const [forgetting, setForgetting] = useState(false);
  const selectedFile = useRef<File | null>(null);
  useEffect(() => {
    let cancelled = false;
    active.current = true;
    const dialog = ref.current;
    dialog?.showModal();
    void Promise.all([
      window.mterminal.listHosts(),
      window.mterminal.listHostGroups(),
      window.mterminal.listSshIdentities(),
    ])
      .then(([hosts, groups, identities]) => {
        const host = hosts.find((item) => item.id === hostId);
        if (host && !cancelled) {
          const resolved = resolveHost(host, groups);
          const identity = identities.find((item) => item.id === resolved.identityId);
          setIdentityId(identity?.id ?? null);
          setUsername((current) => current || identity?.username || resolved.username);
          setMissingUsername(!(identity?.username || resolved.username));
          setMethod(identity?.method ?? 'password');
          if (identity) {
            void window.mterminal
              .getSshKeyStatus(identity.id)
              .then((status) => {
                if (!cancelled) {
                  setSavedKey(status.available && status.saved);
                  setUseSavedKey(
                    status.available && status.saved && identity.method === 'privateKey',
                  );
                }
              })
              .catch(() => {
                if (!cancelled) setSavedKey(false);
              });
          }
          void (async () => {
            try {
              const own = await window.mterminal.getSshPasswordStatus(hostId);
              const shared =
                !own.saved && identity?.method === 'password'
                  ? await window.mterminal.getSshPasswordStatus(identity.id)
                  : undefined;
              if (cancelled) return;
              const owner = shared ? identity!.id : hostId;
              const status = shared ?? own;
              setPasswordOwner(owner);
              setVaultAvailable(status.available);
              setSavedPassword(status.saved);
              // After a rejected saved password, ask for the new one instead.
              setUseSavedPassword(status.available && status.saved && !notice);
            } catch {
              if (!cancelled) setVaultAvailable(false);
            } finally {
              if (!cancelled) setLoadingCredentials(false);
            }
          })();
        } else if (!cancelled) {
          setLoadingCredentials(false);
          setError('This saved host no longer exists.');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadingCredentials(false);
          setError('Unable to load saved connection details. Close this dialog and retry.');
        }
      });
    return () => {
      cancelled = true;
      active.current = false;
      selectedFile.current = null;
      dialog?.close();
    };
  }, [hostId, notice]);
  return (
    <dialog ref={ref} className="terminal-dialog" aria-labelledby="ssh-title" onCancel={cancel}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (pendingSubmit.current || loadingCredentials || !active.current) return;
          pendingSubmit.current = true;
          setSubmitting(true);
          setError('');
          const form = event.currentTarget;
          const data = new FormData(form);
          try {
            const credentials = validateSshCredentials({
              username: data.get('username'),
              method,
              ...(method === 'password' && useSavedPassword
                ? { useSavedPassword: true, savedPasswordIdentityId: passwordOwner }
                : { password: data.get('password') }),
              ...(method === 'privateKey' && useSavedKey
                ? { useSavedPrivateKey: true, savedPrivateKeyIdentityId: identityId }
                : { privateKey, passphrase: data.get('passphrase') ?? '' }),
              keyboardInteractive: data.get('keyboardInteractive') === 'on',
              fingerprint: data.get('fingerprint'),
            });
            if (rememberUsername && missingUsername)
              await rememberMissingUsername(hostId, credentials.username);
            if (!active.current) return;
            if (rememberPassword && vaultAvailable && credentials.password)
              await window.mterminal.saveSshPassword(passwordOwner, credentials.password);
            if (!active.current) return;
            selectedFile.current = null;
            setPrivateKey('');
            form.reset();
            onConnect(credentials);
          } catch (error) {
            setError(
              error instanceof Error
                ? error.message
                : 'Check the username, authentication fields and SHA256 fingerprint.',
            );
          } finally {
            pendingSubmit.current = false;
            if (active.current) setSubmitting(false);
          }
        }}
      >
        <h2 id="ssh-title">
          {reconnect ? 'Reconnect' : 'Connect'} to “{title}”
        </h2>
        {loadingCredentials && <p role="status">Checking saved connection details…</p>}
        {notice && (
          <p className="dialog-error" role="alert">
            {notice}
          </p>
        )}
        {reconnect && (
          <p>
            Reconnect starts a new remote shell and clears the displayed terminal output. The
            previous session is lost. Commands are never replayed. Cancel keeps the current output.
          </p>
        )}
        <label>
          SSH username
          <input
            name="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            maxLength={100}
            autoComplete="off"
          />
        </label>
        {missingUsername && (
          <label>
            <input
              type="checkbox"
              checked={rememberUsername}
              disabled={submitting}
              onChange={(event) => setRememberUsername(event.target.checked)}
            />
            Remember this username for this host on this device
          </label>
        )}
        <label>
          Authentication method
          <select
            value={method}
            onChange={(event) => {
              setMethod(event.target.value as typeof method);
              selectedFile.current = null;
              setPrivateKey('');
              setUseSavedPassword(false);
              setUseSavedKey(false);
              setRememberPassword(false);
              setKeyLoading(false);
              setError('');
            }}
          >
            <option value="password">Password</option>
            <option value="privateKey">Private key</option>
            <option value="keyboard-interactive">Keyboard-interactive</option>
          </select>
        </label>
        {method === 'password' && vaultAvailable && savedPassword && (
          <label>
            <input
              type="checkbox"
              checked={useSavedPassword}
              onChange={(event) => {
                setUseSavedPassword(event.target.checked);
                setRememberPassword(false);
              }}
            />
            Use the saved password
          </label>
        )}
        {method === 'password' && !useSavedPassword && (
          <label>
            Password
            <input
              key="password"
              name="password"
              type="password"
              maxLength={4096}
              autoComplete="off"
            />
          </label>
        )}
        {method === 'password' && vaultAvailable && !useSavedPassword && (
          <label>
            <input
              type="checkbox"
              checked={rememberPassword}
              onChange={(event) => setRememberPassword(event.target.checked)}
            />
            Save password on this device for one-click connections
          </label>
        )}
        {method === 'password' && vaultAvailable && (
          <p className="field-hint">
            Saved passwords stay in the encrypted vault when a terminal closes. Unlock the vault
            after restarting the app to use them again.
          </p>
        )}
        {method === 'password' && !vaultAvailable && !loadingCredentials && (
          <p role="status">
            This password will not be saved. Cancel this dialog, set up or unlock the vault in the
            status bar, then connect with Save password selected. Otherwise it is used only for this
            connection.
          </p>
        )}
        {savedPassword && (
          <button type="button" onClick={() => setForgetting(true)}>
            Forget saved password
          </button>
        )}
        {forgetting && (
          <ConfirmDialog
            title="Forget the saved password?"
            confirmLabel="Forget password"
            danger
            onConfirm={async () => {
              try {
                await window.mterminal.deleteSshPassword(passwordOwner);
              } catch (cause) {
                throw new Error(errorMessage(cause, 'Unable to forget saved password.'), { cause });
              }
              setSavedPassword(false);
              setUseSavedPassword(false);
              setForgetting(false);
            }}
            onCancel={() => setForgetting(false)}
          >
            <p>
              The saved password is removed from the local vault. You will be asked for it on the
              next connection.
            </p>
          </ConfirmDialog>
        )}
        {method === 'privateKey' && (
          <>
            {identityId && savedKey && (
              <label>
                <input
                  type="checkbox"
                  checked={useSavedKey}
                  onChange={(event) => setUseSavedKey(event.target.checked)}
                />
                Use the managed private key for this identity
              </label>
            )}
            {!useSavedKey && (
              <>
                <label>
                  Private key file
                  <input
                    type="file"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      selectedFile.current = file ?? null;
                      setPrivateKey('');
                      setError('');
                      if (!file) {
                        setKeyLoading(false);
                        return;
                      }
                      if (file.size > 256 * 1024) {
                        setKeyLoading(false);
                        setError('Private key files must be at most 256 KiB.');
                        return;
                      }
                      setKeyLoading(true);
                      void file
                        .text()
                        .then((text) => {
                          if (selectedFile.current === file) {
                            setPrivateKey(text);
                            setKeyLoading(false);
                          }
                        })
                        .catch(() => {
                          if (selectedFile.current === file) {
                            setError('Unable to read private key file.');
                            setKeyLoading(false);
                          }
                        });
                    }}
                  />
                </label>
                <label>
                  Key passphrase (if encrypted)
                  <input
                    key="passphrase"
                    name="passphrase"
                    type="password"
                    maxLength={4096}
                    autoComplete="off"
                  />
                </label>
                {keyLoading && <p role="status">Reading key…</p>}
              </>
            )}
          </>
        )}
        {method !== 'keyboard-interactive' && (
          <label>
            <input name="keyboardInteractive" type="checkbox" />
            Continue with keyboard-interactive challenges if requested
          </label>
        )}
        <label>
          Expected server fingerprint (optional)
          <input
            name="fingerprint"
            placeholder="SHA256:…"
            maxLength={50}
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        <p>
          Unknown server keys require confirmation. If you have a fingerprint from a trusted
          channel, enter it to require an exact match.
        </p>
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" onClick={cancel}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={
              loadingCredentials ||
              submitting ||
              keyLoading ||
              (method === 'privateKey' && !useSavedKey && !privateKey)
            }
          >
            {reconnect ? 'Reconnect' : 'Connect'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
