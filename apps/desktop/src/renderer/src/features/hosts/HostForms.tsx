import { useId, useState, type FormEvent, type ReactNode } from 'react';
import {
  resolveHost,
  validateGroup,
  validateHost,
  type HostGroup,
  type SavedHost,
  type SshIdentity,
} from '../../../../shared/hosts';
import { useModalDialog } from '../../components/ConfirmDialog';
import { Icon } from '../../components/Icon';

/** A form that slides in from the right, keeping the host list visible behind it. */
function SidePanel({
  title,
  description,
  busy,
  error,
  submitLabel,
  onSubmit,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  busy: boolean;
  error: string;
  submitLabel: string;
  onSubmit: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useModalDialog();
  return (
    <dialog
      ref={ref}
      className="side-panel"
      aria-labelledby="side-panel-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (!busy) onSubmit();
        }}
      >
        <header className="side-panel-header">
          <div>
            <h2 id="side-panel-title">{title}</h2>
            {description && <p>{description}</p>}
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
        <div className="side-panel-body">{children}</div>
        <footer className="side-panel-footer">
          {error && (
            <p className="dialog-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" disabled={busy}>
              {busy ? 'Saving…' : submitLabel}
            </button>
          </div>
        </footer>
      </form>
    </dialog>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="form-section">
      <legend>{title}</legend>
      {children}
    </fieldset>
  );
}

/** A labelled control with an optional hint that screen readers announce with it. */
function Field({
  label,
  hint,
  extra,
  children,
}: {
  label: string;
  hint?: ReactNode;
  /** Content after the control, such as a related checkbox. */
  extra?: ReactNode;
  children: (props: { id: string; 'aria-describedby': string | undefined }) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children({ id, 'aria-describedby': hint ? hintId : undefined })}
      {extra}
      {hint && (
        <span id={hintId} className="field-hint">
          {hint}
        </span>
      )}
    </div>
  );
}

function identityLabel(identities: SshIdentity[], id: string | null | undefined) {
  const identity = identities.find((item) => item.id === id);
  return identity ? `${identity.name} · ${identity.username}` : undefined;
}

const groupPathMessage =
  'Group paths use letters, numbers and single slashes between levels, such as Work/Production.';

/** Explains why a host draft was rejected, based on the validator's message. */
function hostValidationMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : '';
  if (message === 'Invalid tag.' || message === 'Invalid tags.')
    return 'Tags can be up to 32 characters, without commas or slashes, and at most 20 per host.';
  if (message === 'Invalid group path.') return groupPathMessage;
  return 'Check the address, port and username. The address and username cannot contain spaces or “@”, and the port must be 1–65535.';
}

export function HostForm({
  host,
  groups,
  identities,
  initialGroup,
  onClose,
  onSaved,
}: {
  host: SavedHost | undefined;
  groups: HostGroup[];
  identities: SshIdentity[];
  /** Group to preselect for a new host, usually the folder being viewed. */
  initialGroup: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [address, setAddress] = useState(host?.address ?? '');
  const [name, setName] = useState(host?.name ?? '');
  const [port, setPort] = useState(String(host?.port ?? 22));
  const [username, setUsername] = useState(host?.username ?? '');
  const [inheritPort, setInheritPort] = useState(host?.inheritPort ?? false);
  const [inheritUsername, setInheritUsername] = useState(host?.inheritUsername ?? false);
  const [identityId, setIdentityId] = useState(host?.identityId ?? '');
  const [groupPath, setGroupPath] = useState(host?.groupPath ?? initialGroup);
  const [tags, setTags] = useState(host?.tags?.join(', ') ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // What this host would get from its group if it inherited everything.
  const inherited = resolveHost(
    {
      name: 'x',
      address: 'x',
      port: 22,
      username: '',
      protocol: 'ssh',
      groupPath,
      inheritPort: true,
      inheritUsername: true,
      identityId: null,
    },
    groups,
  );
  const groupIdentity = identityLabel(identities, inherited.identityId);

  async function save() {
    let draft;
    try {
      draft = validateHost({
        name: name.trim() || address.trim(),
        address,
        port: Number(port),
        username,
        protocol: 'ssh',
        groupPath,
        tags: tags
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
        inheritPort,
        inheritUsername,
        identityId: identityId || null,
      });
    } catch (cause) {
      setError(hostValidationMessage(cause));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await window.mterminal.saveHost(draft, host?.id);
      onSaved();
    } catch {
      setError('Unable to save the host. Check local storage, then retry.');
      setBusy(false);
    }
  }

  return (
    <SidePanel
      title={host ? `Edit “${host.name}”` : 'New host'}
      description="SSH connection profile."
      busy={busy}
      error={error}
      submitLabel="Save host"
      onSubmit={() => void save()}
      onClose={onClose}
    >
      <Section title="Connection">
        <Field label="Address">
          {(props) => (
            <input
              {...props}
              name="address"
              required
              maxLength={253}
              spellCheck={false}
              autoComplete="off"
              autoFocus={!host}
              placeholder="server.example.com or 192.168.1.10"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
            />
          )}
        </Field>
        <Field label="Name" hint="Shown on the host card. Defaults to the address.">
          {(props) => (
            <input
              {...props}
              name="name"
              maxLength={100}
              placeholder={address.trim() || 'Production web'}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <div className="field-row">
          <Field
            label="Port"
            extra={
              <label className="check-field">
                <input
                  type="checkbox"
                  aria-label="Use group default port"
                  checked={inheritPort}
                  onChange={(event) => setInheritPort(event.target.checked)}
                />
                Use group default ({inherited.port})
              </label>
            }
          >
            {(props) => (
              <input
                {...props}
                name="port"
                type="number"
                min={1}
                max={65535}
                required
                readOnly={inheritPort}
                value={inheritPort ? inherited.port : port}
                onChange={(event) => setPort(event.target.value)}
              />
            )}
          </Field>
          <Field
            label="Username"
            extra={
              <label className="check-field">
                <input
                  type="checkbox"
                  aria-label="Use group default username"
                  checked={inheritUsername}
                  onChange={(event) => setInheritUsername(event.target.checked)}
                />
                Use group default{inherited.username ? ` (${inherited.username})` : ''}
              </label>
            }
          >
            {(props) => (
              <input
                {...props}
                name="username"
                maxLength={100}
                autoComplete="off"
                spellCheck={false}
                readOnly={inheritUsername}
                placeholder={inheritUsername ? 'Not set by group' : 'Optional'}
                value={inheritUsername ? inherited.username : username}
                onChange={(event) => setUsername(event.target.value)}
              />
            )}
          </Field>
        </div>
      </Section>
      <Section title="Authentication">
        <Field
          label="SSH identity"
          hint="An identity supplies the SSH username and authentication method, and overrides the username above."
        >
          {(props) => (
            <select
              {...props}
              name="identityId"
              value={identityId}
              onChange={(event) => setIdentityId(event.target.value)}
            >
              <option value="">
                {groupIdentity ? `Group default (${groupIdentity})` : 'None — ask when connecting'}
              </option>
              {identities.map((identity) => (
                <option key={identity.id} value={identity.id}>
                  {identity.name} · {identity.username}
                </option>
              ))}
            </select>
          )}
        </Field>
      </Section>
      <Section title="Organization">
        <Field label="Group">
          {(props) => (
            <select
              {...props}
              name="groupPath"
              value={groupPath}
              onChange={(event) => setGroupPath(event.target.value)}
            >
              <option value="">Ungrouped</option>
              {groups.map((group) => (
                <option key={group.path} value={group.path}>
                  {group.path}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Tags" hint="Separate tags with commas.">
          {(props) => (
            <input
              {...props}
              name="tags"
              maxLength={678}
              placeholder="production, web"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
            />
          )}
        </Field>
      </Section>
    </SidePanel>
  );
}

export function GroupForm({
  group,
  parent,
  identities,
  onClose,
  onSaved,
}: {
  group: HostGroup | undefined;
  /** Parent path to prefill for a new group, usually the folder being viewed. */
  parent: string;
  identities: SshIdentity[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [path, setPath] = useState(group?.path ?? (parent ? parent + '/' : ''));
  const [port, setPort] = useState(group?.port == null ? '' : String(group.port));
  const [username, setUsername] = useState(group?.username ?? '');
  const [identityId, setIdentityId] = useState(group?.identityId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    let draft;
    try {
      draft = validateGroup({
        path,
        port: port ? Number(port) : null,
        username: username || null,
        identityId: identityId || null,
      });
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message === 'Invalid group path.'
          ? groupPathMessage
          : 'Check the defaults: the port must be 1–65535 and the username cannot contain spaces or “@”.',
      );
      return;
    }
    setBusy(true);
    setError('');
    try {
      await window.mterminal.saveHostGroup(draft);
      onSaved();
    } catch {
      setError(
        'Unable to save the group. Make sure its parent group exists, then check local storage.',
      );
      setBusy(false);
    }
  }

  return (
    <SidePanel
      title={group ? `Edit “${group.path}”` : 'New group'}
      description="Hosts in this group, and in groups nested inside it, can use these defaults."
      busy={busy}
      error={error}
      submitLabel="Save group"
      onSubmit={() => void save()}
      onClose={onClose}
    >
      <Section title="Group">
        <Field
          label="Group path"
          hint={
            group
              ? 'Paths cannot be changed after creation.'
              : 'Use “/” to nest groups. Create the parent group first.'
          }
        >
          {(props) => (
            <input
              {...props}
              name="path"
              required
              maxLength={200}
              readOnly={!!group}
              autoFocus={!group}
              placeholder="Work/Production"
              value={path}
              onChange={(event) => setPath(event.target.value)}
            />
          )}
        </Field>
      </Section>
      <Section title="Defaults">
        <div className="field-row">
          <Field label="Default port">
            {(props) => (
              <input
                {...props}
                name="port"
                type="number"
                min={1}
                max={65535}
                placeholder="Inherit"
                value={port}
                onChange={(event) => setPort(event.target.value)}
              />
            )}
          </Field>
          <Field label="Default username">
            {(props) => (
              <input
                {...props}
                name="username"
                maxLength={100}
                autoComplete="off"
                spellCheck={false}
                placeholder="Inherit"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            )}
          </Field>
        </div>
        <Field
          label="Default SSH identity"
          hint="Blank values inherit from the parent group. Hosts use the port and username only when set to use the group default, and can choose their own identity."
        >
          {(props) => (
            <select
              {...props}
              name="identityId"
              value={identityId}
              onChange={(event) => setIdentityId(event.target.value)}
            >
              <option value="">Inherit from parent group</option>
              {identities.map((identity) => (
                <option key={identity.id} value={identity.id}>
                  {identity.name} · {identity.username}
                </option>
              ))}
            </select>
          )}
        </Field>
      </Section>
    </SidePanel>
  );
}
