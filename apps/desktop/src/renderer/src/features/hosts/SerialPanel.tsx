import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  defaultSerialSettings,
  describeSerial,
  validateSerialSettings,
  MAX_SERIAL_PROFILES,
  SERIAL_BAUD_RATES,
  type SerialPortInfo,
  type SerialProfile,
  type SerialSettings,
} from '../../../../shared/serial';
import { ConfirmDialog, errorMessage, useModalDialog } from '../../components/ConfirmDialog';
import { Icon } from '../../components/Icon';

type Draft = Omit<SerialSettings, 'baudRate'> & { baudRate: string; id?: string };

function toDraft(settings: SerialSettings, id?: string): Draft {
  return { ...settings, baudRate: String(settings.baudRate), ...(id ? { id } : {}) };
}
function portLabel(port: SerialPortInfo): string {
  const details = [port.manufacturer, port.vendorId && `${port.vendorId}:${port.productId}`]
    .filter(Boolean)
    .join(' · ');
  return details ? `${port.path} — ${details}` : port.path;
}

/** Side panel listing saved serial profiles, with a form to add, edit and connect them. */
export function SerialPanel({
  onClose,
  onConnect,
}: {
  onClose: () => void;
  onConnect: (profile: SerialProfile) => void;
}) {
  const ref = useModalDialog();
  const [profiles, setProfiles] = useState<SerialProfile[] | null>(null);
  const [ports, setPorts] = useState<SerialPortInfo[] | null>(null);
  const [portsError, setPortsError] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<SerialProfile | null>(null);

  const loadProfiles = useCallback(async () => {
    try {
      setProfiles(await window.mterminal.listSerialProfiles());
    } catch (cause) {
      setProfiles([]);
      setError(errorMessage(cause, 'Unable to load serial profiles.'));
    }
  }, []);
  const refreshPorts = useCallback(async () => {
    setPortsError('');
    try {
      setPorts(await window.mterminal.listSerialPorts());
    } catch (cause) {
      setPorts([]);
      setPortsError(errorMessage(cause, 'Unable to list serial devices.'));
    }
  }, []);
  useEffect(() => {
    let cancelled = false;
    Promise.all([window.mterminal.listSerialProfiles(), window.mterminal.listSerialPorts()])
      .then(([savedProfiles, devices]) => {
        if (cancelled) return;
        setProfiles(savedProfiles);
        setPorts(devices);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setProfiles((current) => current ?? []);
        setPorts((current) => current ?? []);
        setPortsError(errorMessage(cause, 'Unable to list serial devices.'));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = (patch: Partial<Draft>) =>
    setDraft((current) => (current ? { ...current, ...patch } : current));

  async function save(connect: boolean) {
    if (!draft) return;
    setError('');
    let settings: SerialSettings;
    try {
      settings = validateSerialSettings({
        name: draft.name,
        path: draft.path,
        baudRate: Number(draft.baudRate),
        dataBits: draft.dataBits,
        parity: draft.parity,
        stopBits: draft.stopBits,
        flowControl: draft.flowControl,
        newline: draft.newline,
        localEcho: draft.localEcho,
      });
    } catch (cause) {
      setError(errorMessage(cause, 'Check the serial settings.'));
      return;
    }
    setBusy(true);
    try {
      const saved = await window.mterminal.saveSerialProfile(settings, draft.id);
      setDraft(null);
      await loadProfiles();
      if (connect) {
        onConnect(saved);
        onClose();
      }
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to save the serial profile.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      className="side-panel"
      aria-labelledby="serial-panel-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (draft && !busy) void save(false);
        }}
      >
        <header className="side-panel-header">
          <div>
            <h2 id="serial-panel-title">
              {draft ? (draft.id ? 'Edit serial profile' : 'New serial profile') : 'Serial devices'}
            </h2>
            <p>Routers, switches and boards connected by a USB or serial cable.</p>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close panel"
            disabled={busy}
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="side-panel-body">
          {!draft ? (
            profiles === null ? (
              <p role="status">Loading serial profiles…</p>
            ) : profiles.length ? (
              <ul className="serial-list" aria-label="Serial profiles">
                {profiles.map((profile) => {
                  const present = ports?.some((port) => port.path === profile.path);
                  return (
                    <li key={profile.id} className="serial-row">
                      <div>
                        <strong>{profile.name}</strong>
                        <span>
                          {describeSerial(profile)}
                          {ports && !present ? ' · not connected' : ''}
                        </span>
                      </div>
                      <div className="serial-actions">
                        <button
                          type="button"
                          className="primary-button"
                          onClick={() => {
                            onConnect(profile);
                            onClose();
                          }}
                          aria-label={`Connect ${profile.name}`}
                        >
                          Connect
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => {
                            setError('');
                            setDraft(toDraft(profile, profile.id));
                          }}
                          aria-label={`Edit ${profile.name}`}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => setDeleting(profile)}
                          aria-label={`Delete ${profile.name}`}
                        >
                          Delete
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="serial-empty">
                <h3>No serial profiles yet</h3>
                <p>Plug in the device, then create a profile with its port and speed.</p>
              </div>
            )
          ) : (
            <div className="serial-form">
              <label>
                Name
                <input
                  value={draft.name}
                  maxLength={64}
                  placeholder="Router console"
                  onChange={(event) => update({ name: event.target.value })}
                />
              </label>
              <label>
                Device
                <div className="serial-device">
                  <select
                    value={ports?.some((port) => port.path === draft.path) ? draft.path : ''}
                    onChange={(event) => {
                      if (event.target.value) update({ path: event.target.value });
                    }}
                  >
                    <option value="">
                      {ports === null
                        ? 'Looking for devices…'
                        : ports.length
                          ? 'Choose a detected device'
                          : 'No devices detected'}
                    </option>
                    {ports?.map((port) => (
                      <option key={port.path} value={port.path}>
                        {portLabel(port)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void refreshPorts()}
                  >
                    Refresh
                  </button>
                </div>
              </label>
              <label>
                Port path
                <input
                  value={draft.path}
                  maxLength={255}
                  spellCheck={false}
                  placeholder="/dev/ttyUSB0 or COM3"
                  onChange={(event) => update({ path: event.target.value })}
                  required
                />
              </label>
              {portsError && <p className="field-hint">{portsError}</p>}
              <div className="serial-grid">
                <label>
                  Baud rate
                  <input
                    list="serial-baud-rates"
                    value={draft.baudRate}
                    inputMode="numeric"
                    onChange={(event) =>
                      update({ baudRate: event.target.value.replace(/\D/g, '') })
                    }
                    required
                  />
                  <datalist id="serial-baud-rates">
                    {SERIAL_BAUD_RATES.map((rate) => (
                      <option key={rate} value={rate} />
                    ))}
                  </datalist>
                </label>
                <label>
                  Data bits
                  <select
                    value={draft.dataBits}
                    onChange={(event) =>
                      update({ dataBits: Number(event.target.value) as Draft['dataBits'] })
                    }
                  >
                    {[8, 7, 6, 5].map((bits) => (
                      <option key={bits} value={bits}>
                        {bits}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Parity
                  <select
                    value={draft.parity}
                    onChange={(event) => update({ parity: event.target.value as Draft['parity'] })}
                  >
                    <option value="none">None</option>
                    <option value="even">Even</option>
                    <option value="odd">Odd</option>
                    <option value="mark">Mark</option>
                    <option value="space">Space</option>
                  </select>
                </label>
                <label>
                  Stop bits
                  <select
                    value={draft.stopBits}
                    onChange={(event) =>
                      update({ stopBits: Number(event.target.value) as Draft['stopBits'] })
                    }
                  >
                    <option value={1}>1</option>
                    <option value={1.5}>1.5</option>
                    <option value={2}>2</option>
                  </select>
                </label>
                <label>
                  Flow control
                  <select
                    value={draft.flowControl}
                    onChange={(event) =>
                      update({ flowControl: event.target.value as Draft['flowControl'] })
                    }
                  >
                    <option value="none">None</option>
                    <option value="rtscts">Hardware (RTS/CTS)</option>
                    <option value="xonxoff">Software (XON/XOFF)</option>
                  </select>
                </label>
                <label>
                  Enter sends
                  <select
                    value={draft.newline}
                    onChange={(event) =>
                      update({ newline: event.target.value as Draft['newline'] })
                    }
                  >
                    <option value="cr">CR (most devices)</option>
                    <option value="lf">LF</option>
                    <option value="crlf">CR LF</option>
                  </select>
                </label>
              </div>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={draft.localEcho}
                  onChange={(event) => update({ localEcho: event.target.checked })}
                />
                Show what I type (local echo, for devices that do not echo)
              </label>
              <p className="field-hint">
                Common settings: Cisco and most network gear 9600 8N1; Arduino and ESP32 usually
                115200 8N1.
              </p>
            </div>
          )}
        </div>
        <footer className="side-panel-footer">
          {error && (
            <p className="dialog-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            {draft ? (
              <>
                <button type="button" disabled={busy} onClick={() => setDraft(null)}>
                  Back
                </button>
                <button type="submit" className="secondary-button" disabled={busy}>
                  {busy ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  className="primary-button"
                  disabled={busy}
                  onClick={() => void save(true)}
                >
                  Save and connect
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={onClose}>
                  Close
                </button>
                <button
                  type="button"
                  className="primary-button"
                  disabled={!profiles || profiles.length >= MAX_SERIAL_PROFILES}
                  onClick={() => {
                    setError('');
                    const detected = ports?.[0]?.path ?? '';
                    setDraft(toDraft({ ...defaultSerialSettings, path: detected }));
                  }}
                >
                  New serial profile
                </button>
              </>
            )}
          </div>
        </footer>
      </form>
      {deleting && (
        <ConfirmDialog
          title={`Delete “${deleting.name}”?`}
          confirmLabel="Delete profile"
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            await window.mterminal.deleteSerialProfile(deleting.id);
            setDeleting(null);
            await loadProfiles();
          }}
        >
          <p>The saved settings for {describeSerial(deleting)} are removed. Open tabs stay open.</p>
        </ConfirmDialog>
      )}
    </dialog>
  );
}
