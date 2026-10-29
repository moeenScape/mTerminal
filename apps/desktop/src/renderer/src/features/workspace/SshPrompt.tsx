import { resolveHost } from '../../../../shared/hosts';
import { useEffect, useRef, useState } from 'react';
import { validateSshCredentials, type SshCredentials } from '../../../../shared/ssh';

export function SshPrompt({
  title,
  reconnect,
  hostId,
  onConnect,
  onCancel,
}: {
  title: string;
  reconnect: boolean;
  hostId: string;
  onConnect: (credentials: SshCredentials) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [method, setMethod] = useState<'password' | 'privateKey' | 'keyboard-interactive'>(
    'password',
  );
  const [privateKey, setPrivateKey] = useState('');
  const [keyLoading, setKeyLoading] = useState(false);
  const [identityId, setIdentityId] = useState<string | null>(null);
  const [vaultAvailable, setVaultAvailable] = useState(false);
  const [savedPassword, setSavedPassword] = useState(false);
  const [savedKey, setSavedKey] = useState(false);
  const [useSavedKey, setUseSavedKey] = useState(false);
  const [useSavedPassword, setUseSavedPassword] = useState(false);
  const [rememberPassword, setRememberPassword] = useState(false);
  const selectedFile = useRef<File | null>(null);
  useEffect(() => {
    let cancelled = false;
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
            void window.mterminal
              .getSshPasswordStatus(identity.id)
              .then((status) => {
                if (cancelled) return;
                setVaultAvailable(status.available);
                setSavedPassword(status.saved);
                setUseSavedPassword(status.available && status.saved);
              })
              .catch(() => {
                if (!cancelled) setVaultAvailable(false);
              });
          }
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      selectedFile.current = null;
      dialog?.close();
    };
  }, [hostId]);
  return (
    <dialog ref={ref} className="terminal-dialog" aria-labelledby="ssh-title" onCancel={onCancel}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          try {
            const credentials = validateSshCredentials({
              username: data.get('username'),
              method,
              ...(method === 'password' && useSavedPassword
                ? { useSavedPassword: true, savedPasswordIdentityId: identityId }
                : { password: data.get('password') }),
              ...(method === 'privateKey' && useSavedKey
                ? { useSavedPrivateKey: true, savedPrivateKeyIdentityId: identityId }
                : { privateKey, passphrase: data.get('passphrase') ?? '' }),
              keyboardInteractive: data.get('keyboardInteractive') === 'on',
              fingerprint: data.get('fingerprint'),
            });
            if (rememberPassword && identityId && credentials.password !== undefined)
              await window.mterminal.saveSshPassword(identityId, credentials.password);
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
          }
        }}
      >
        <h2 id="ssh-title">
          {reconnect ? 'Reconnect' : 'Connect'} to “{title}”
        </h2>
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
        {method === 'password' && identityId && vaultAvailable && savedPassword && (
          <label>
            <input
              type="checkbox"
              checked={useSavedPassword}
              onChange={(event) => {
                setUseSavedPassword(event.target.checked);
                setRememberPassword(false);
              }}
            />
            Use the saved password for this identity
          </label>
        )}
        {method === 'password' && !useSavedPassword && (
          <label>
            Session password
            <input
              key="password"
              name="password"
              type="password"
              maxLength={4096}
              autoComplete="off"
            />
          </label>
        )}
        {method === 'password' && identityId && vaultAvailable && !useSavedPassword && (
          <label>
            <input
              type="checkbox"
              checked={rememberPassword}
              onChange={(event) => setRememberPassword(event.target.checked)}
            />
            Save password securely for this identity on this device
          </label>
        )}
        {identityId && !vaultAvailable && (
          <p role="status">Secure password storage is unavailable. Passwords will not be saved.</p>
        )}
        {method === 'password' && !identityId && (
          <p>Assign an SSH identity to this host or group to save its password securely.</p>
        )}
        {savedPassword && identityId && (
          <button
            type="button"
            onClick={async () => {
              if (!window.confirm('Forget the saved password for this SSH identity?')) return;
              try {
                await window.mterminal.deleteSshPassword(identityId);
                setSavedPassword(false);
                setUseSavedPassword(false);
              } catch (error) {
                setError(
                  error instanceof Error ? error.message : 'Unable to forget saved password.',
                );
              }
            }}
          >
            Forget saved password
          </button>
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
          channel, enter it to require an exact match. Credentials are used only for this
          connection.
        </p>
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={keyLoading || (method === 'privateKey' && !useSavedKey && !privateKey)}
          >
            {reconnect ? 'Reconnect' : 'Connect'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
