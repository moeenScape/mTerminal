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
              password: data.get('password'),
              fingerprint: data.get('fingerprint'),
            });
            event.currentTarget.reset();
            onConnect(credentials);
          } catch {
            setError('Enter a username and a valid SHA256 fingerprint.');
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
          Session password
          <input name="password" type="password" maxLength={4096} autoComplete="off" />
        </label>
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
          connection only. This connection uses password authentication.
        </p>
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit">Connect</button>
        </div>
      </form>
    </dialog>
  );
}
