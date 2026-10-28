import { resolveHost } from '../../../../shared/hosts';
import { useEffect, useRef, useState } from 'react';
import { validateSshCredentials, type SshCredentials } from '../../../../shared/ssh';

export function SshPrompt({
  title,
  hostId,
  onConnect,
  onCancel,
}: {
  title: string;
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
  const selectedFile = useRef<File | null>(null);
  useEffect(() => {
    let cancelled = false;
    const dialog = ref.current;
    dialog?.showModal();
    void Promise.all([window.mterminal.listHosts(), window.mterminal.listHostGroups()])
      .then(([hosts, groups]) => {
        const host = hosts.find((item) => item.id === hostId);
        if (host && !cancelled)
          setUsername((current) => current || resolveHost(host, groups).username);
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
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          try {
            const credentials = validateSshCredentials({
              username: data.get('username'),
              method,
              password: data.get('password'),
              privateKey,
              passphrase: data.get('passphrase') ?? '',
              keyboardInteractive: data.get('keyboardInteractive') === 'on',
              fingerprint: data.get('fingerprint'),
            });
            selectedFile.current = null;
            setPrivateKey('');
            event.currentTarget.reset();
            onConnect(credentials);
          } catch {
            setError('Check the username, authentication fields and SHA256 fingerprint.');
          }
        }}
      >
        <h2 id="ssh-title">Connect to “{title}”</h2>
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
              setKeyLoading(false);
              setError('');
            }}
          >
            <option value="password">Password</option>
            <option value="privateKey">Private key</option>
            <option value="keyboard-interactive">Keyboard-interactive</option>
          </select>
        </label>
        {method === 'password' && (
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
        {method === 'privateKey' && (
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
        {method !== 'keyboard-interactive' && (
          <label>
            <input name="keyboardInteractive" type="checkbox" />
            Continue with keyboard-interactive challenges if requested
          </label>
        )}
        <label>
          Server fingerprint
          <input
            name="fingerprint"
            required
            placeholder="SHA256:…"
            maxLength={50}
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        <p>
          Obtain the server fingerprint through a trusted channel. The password is used for this
          connection only. Private keys, passphrases and challenge answers are not saved.
        </p>
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" disabled={keyLoading || (method === 'privateKey' && !privateKey)}>
            Connect
          </button>
        </div>
      </form>
    </dialog>
  );
}
