import { useState } from 'react';
import type {
  AccountSummary,
  DeviceDirectoryAction,
  DeviceDirectoryKey,
} from '../../../../shared/accounts.js';
import { errorMessage } from '../../components/ConfirmDialog';

interface AccountDevicesProps {
  account: AccountSummary;
  busy: boolean;
  refresh: () => Promise<boolean>;
}

export function AccountDevices({ account, busy, refresh }: AccountDevicesProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [rename, setRename] = useState<{ deviceId: string; name: string }>();
  const [keys, setKeys] = useState<DeviceDirectoryKey[]>();
  const [identities, setIdentities] = useState<{ id: string; name: string }[]>([]);
  const [identityId, setIdentityId] = useState('');
  const disabled = pending || busy;

  async function run(action: DeviceDirectoryAction) {
    setPending(true);
    setError('');
    setNotice('');
    try {
      if (action.kind === 'status') {
        const local = await window.mterminal.listSshIdentities();
        setIdentities(local.filter((identity) => identity.method === 'privateKey'));
      }
      const next = await window.mterminal.deviceDirectory(action);
      if (keys || action.kind === 'status') setKeys(next);
      if (action.kind === 'rename-device') setRename(undefined);
      if (
        action.kind === 'rename-device' ||
        action.kind === 'retire-device' ||
        action.kind === 'restore-device'
      )
        await refresh();
    } catch (cause) {
      setError(errorMessage(cause, 'The device directory could not be updated.'));
    } finally {
      setPending(false);
    }
  }

  async function copy(key: DeviceDirectoryKey) {
    setError('');
    setNotice('');
    try {
      await window.mterminal.writeClipboardText(key.publicKey);
      setNotice('Public key copied.');
    } catch (cause) {
      setError(errorMessage(cause, 'The public key could not be copied.'));
    }
  }

  return (
    <section aria-label="Account devices">
      <h3>Devices</h3>
      <ul>
        {account.devices.map((device) => {
          const current = device.id === account.currentDeviceId;
          return (
            <li key={device.id}>
              {device.name}
              {current ? ' (this device)' : ''}
              {device.retiredAt ? ' · Retired' : ''}
              {' · Last signed in '}
              {new Date(device.lastSignedInAt).toLocaleString()}
              <div className="settings-actions">
                <button
                  className="secondary-button"
                  type="button"
                  aria-label={`Rename ${device.name}`}
                  onClick={() => setRename({ deviceId: device.id, name: device.name })}
                  disabled={disabled}
                >
                  Rename
                </button>
                {!current && (
                  <button
                    className="secondary-button"
                    type="button"
                    aria-label={`${device.retiredAt ? 'Allow sign-in for' : 'Retire'} ${device.name}`}
                    onClick={() =>
                      void run({
                        kind: device.retiredAt ? 'restore-device' : 'retire-device',
                        deviceId: device.id,
                      })
                    }
                    disabled={disabled}
                  >
                    {device.retiredAt ? 'Allow sign-in' : 'Retire'}
                  </button>
                )}
              </div>
              {rename?.deviceId === device.id && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run({ kind: 'rename-device', ...rename });
                  }}
                >
                  <label>
                    Device name
                    <input
                      value={rename.name}
                      onChange={(event) =>
                        setRename({ deviceId: device.id, name: event.currentTarget.value })
                      }
                      maxLength={80}
                      required
                      disabled={disabled}
                    />
                  </label>
                  <div className="settings-actions">
                    <button
                      className="primary-button"
                      type="submit"
                      disabled={disabled || !rename.name.trim()}
                    >
                      Save name
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={disabled}
                      onClick={() => setRename(undefined)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </li>
          );
        })}
      </ul>
      <h3>SSH public-key directory</h3>
      <p className="field-hint">
        Publish managed public keys for other signed-in devices on this account.
      </p>
      <button
        type="button"
        className="secondary-button"
        disabled={disabled}
        onClick={() => void run({ kind: 'status' })}
      >
        {keys ? 'Refresh directory' : 'Show public-key directory'}
      </button>
      {keys && (
        <>
          {keys.length === 0 && <p>No published public keys.</p>}
          {keys.length > 0 && (
            <ul>
              {keys.map((key) => (
                <li key={`${key.deviceId}/${key.identityId}`}>
                  <strong>{key.name}</strong> · {key.deviceName}
                  <div className="field-hint" style={{ overflowWrap: 'anywhere' }}>
                    {key.fingerprint}
                  </div>
                  <div className="settings-actions">
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => void copy(key)}
                      disabled={disabled}
                    >
                      Copy public key
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() =>
                        void run({
                          kind: 'remove-directory-key',
                          deviceId: key.deviceId,
                          identityId: key.identityId,
                        })
                      }
                      disabled={disabled}
                    >
                      Remove entry
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {identities.length > 0 && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run({ kind: 'publish-device-key', identityId });
              }}
            >
              <label>
                Managed SSH identity
                <select
                  value={identityId}
                  onChange={(event) => setIdentityId(event.currentTarget.value)}
                  disabled={disabled}
                >
                  <option value="">Choose an identity</option>
                  {identities.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>
              <button className="secondary-button" type="submit" disabled={disabled || !identityId}>
                Publish public key
              </button>
            </form>
          )}
          {identities.length === 0 && (
            <p className="field-hint">
              Save a managed SSH key in Hosts to publish its public key from this device.
            </p>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
