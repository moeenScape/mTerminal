import {
  MAX_ENVIRONMENT_VARIABLES,
  type EnvironmentVariable,
} from '../../../../shared/environment';
import { useCallback, useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import {
  resolveHost,
  jumpChain,
  validateGroup,
  validateHost,
  type HostGroup,
  type SavedHost,
  type SshIdentity,
} from '../../../../shared/hosts';
import { describeProxy, type ProxySummary } from '../../../../shared/proxies';
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
  primaryAction,
  children,
}: {
  title: string;
  description?: string;
  busy: boolean;
  error: string;
  submitLabel: string;
  onSubmit: () => void;
  onClose: () => void;
  /** Main button, e.g. Connect; Save then becomes a secondary button. */
  primaryAction?: { label: string; disabled: boolean; onClick: () => void };
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
            <button
              type="submit"
              className={primaryAction ? 'secondary-button' : undefined}
              disabled={busy}
            >
              {busy ? 'Saving…' : submitLabel}
            </button>
            {primaryAction && (
              <button
                type="button"
                className="primary-button"
                disabled={busy || primaryAction.disabled}
                onClick={primaryAction.onClick}
              >
                {primaryAction.label}
              </button>
            )}
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

function EnvironmentFields({
  entries,
  onChange,
  inherited = [],
}: {
  entries: EnvironmentVariable[];
  onChange: (entries: EnvironmentVariable[]) => void;
  inherited?: EnvironmentVariable[];
}) {
  return (
    <Section title="Environment variables">
      <p className="field-hint">
        For new SSH connections and Run on hosts. Parent groups → child groups → host; matching
        names override earlier values. An empty value overrides with empty text; removing a row
        restores inheritance.
      </p>
      {inherited.length > 0 && (
        <details className="environment-inherited">
          <summary>Group values ({inherited.length})</summary>
          <dl>
            {inherited.map(({ name, value }) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{value || '(empty)'}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      {entries.map((entry, index) => (
        <div className="environment-row" key={index}>
          <Field label={`Variable name ${index + 1}`}>
            {(props) => (
              <input
                {...props}
                value={entry.name}
                required
                maxLength={64}
                pattern="[A-Za-z_][A-Za-z0-9_]*"
                placeholder="APP_ENV"
                autoComplete="off"
                spellCheck={false}
                onChange={(event) =>
                  onChange(
                    entries.map((item, n) =>
                      n === index ? { ...item, name: event.target.value } : item,
                    ),
                  )
                }
              />
            )}
          </Field>
          <Field label={`Variable value ${index + 1}`}>
            {(props) => (
              <input
                {...props}
                value={entry.value}
                maxLength={1024}
                placeholder="production"
                autoComplete="off"
                spellCheck={false}
                onChange={(event) =>
                  onChange(
                    entries.map((item, n) =>
                      n === index ? { ...item, value: event.target.value } : item,
                    ),
                  )
                }
              />
            )}
          </Field>
          <button
            type="button"
            className="icon-button"
            aria-label={`Remove variable ${index + 1}`}
            onClick={() => onChange(entries.filter((_, n) => n !== index))}
          >
            <Icon name="close" />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="secondary-button"
        disabled={entries.length >= MAX_ENVIRONMENT_VARIABLES}
        onClick={() => onChange([...entries, { name: '', value: '' }])}
      >
        Add variable
      </button>
      <p className="field-hint">
        Non-secret settings only: values are stored unencrypted and included in workspace backups.
        Up to 32 effective variables; TERM is managed by the terminal. Values are literal text,
        without shell expansion.
      </p>
      <p className="field-hint">
        The SSH server must allow these names through AcceptEnv. A connection can succeed while
        values are ignored; check them in the remote shell. Saving does not change open sessions.
      </p>
    </Section>
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
  if (message.startsWith('Environment')) return message;
  return 'Check the address, port and username. The address and username cannot contain spaces or “@”, and the port must be 1–65535.';
}

export function HostForm({
  host,
  hosts,
  groups,
  identities,
  initialGroup,
  onClose,
  onSaved,
  onSetupVault,
  onConnect,
}: {
  host: SavedHost | undefined;
  /** All saved hosts, offered as jump hosts. */
  hosts: SavedHost[];
  groups: HostGroup[];
  identities: SshIdentity[];
  /** Group to preselect for a new host, usually the folder being viewed. */
  initialGroup: string;
  onClose: () => void;
  onSaved: () => void;
  /** Opens the app's vault setup, needed before a password can be saved. */
  onSetupVault: () => void;
  /** Opens a session to the saved host. */
  onConnect: (host: SavedHost) => void;
}) {
  const [address, setAddress] = useState(host?.address ?? '');
  const [name, setName] = useState(host?.name ?? '');
  const [port, setPort] = useState(String(host?.port ?? 22));
  const [username, setUsername] = useState(host?.username ?? '');
  const [inheritPort, setInheritPort] = useState(host?.inheritPort ?? false);
  const [inheritUsername, setInheritUsername] = useState(host?.inheritUsername ?? false);
  const [identityId, setIdentityId] = useState(host?.identityId ?? '');
  const [jumpHostId, setJumpHostId] = useState(host?.jumpHostId ?? '');
  const [proxyId, setProxyId] = useState(host?.proxyId ?? '');
  const [proxies, setProxies] = useState<ProxySummary[]>([]);
  useEffect(() => {
    let cancelled = false;
    window.mterminal
      .listProxies()
      .then((value) => {
        if (!cancelled) setProxies(value);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const [groupPath, setGroupPath] = useState(host?.groupPath ?? initialGroup);
  const [tags, setTags] = useState(host?.tags?.join(', ') ?? '');
  const [environment, setEnvironment] = useState(host?.environment ?? []);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [forgetPassword, setForgetPassword] = useState(false);
  const [vault, setVault] = useState<'unknown' | 'none' | 'locked' | 'open'>('unknown');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  /** Re-checked on focus so finishing vault setup in its dialog is picked up. */
  const checkVault = useCallback(async () => {
    try {
      const state = await window.mterminal.getVaultState();
      const next =
        !state.available || !state.configured ? 'none' : state.locked ? 'locked' : 'open';
      setVault(next);
      if (next === 'open' && host)
        setPasswordSaved((await window.mterminal.getSshPasswordStatus(host.id)).saved);
    } catch {
      setVault('none');
    }
  }, [host]);
  useEffect(() => {
    // Loads external vault state once; later checks run on focus.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void checkVault();
  }, [checkVault]);

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

  /** Saves the host and its password; with `connect`, then opens a session to it. */
  async function save(connect = false) {
    let draft;
    let effective;
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
        jumpHostId: jumpHostId || null,
        proxyId: proxyId || null,
        environment,
      });
      effective = resolveHost(draft, groups);
      if (draft.jumpHostId) jumpChain({ id: host?.id ?? '', jumpHostId: draft.jumpHostId }, hosts);
    } catch (cause) {
      if (cause instanceof Error && cause.message === 'Invalid jump host chain.') {
        setError(
          'This jump host would loop back to this host or need more than three hops. Choose another jump host.',
        );
        return;
      }
      setError(hostValidationMessage(cause));
      return;
    }
    const loginUsername =
      identities.find((identity) => identity.id === effective.identityId)?.username ||
      effective.username;
    if (password && !loginUsername) {
      setError('Enter an SSH username before saving this login.');
      return;
    }
    setBusy(true);
    setError('');
    if (password && vault !== 'open') {
      setError('Set up or unlock the vault to save the password, or clear the password field.');
      setBusy(false);
      return;
    }
    let saved;
    try {
      saved = await window.mterminal.saveHost(draft, host?.id);
    } catch {
      setError('Unable to save the host. Check local storage, then retry.');
      setBusy(false);
      return;
    }
    try {
      if (password) {
        await window.mterminal.saveSshLogin(saved.id, loginUsername, password);
      } else if (forgetPassword) await window.mterminal.deleteSshPassword(saved.id);
    } catch (cause) {
      setError(
        `The host was saved, but its password was not. ${cause instanceof Error ? cause.message : ''}`,
      );
      setBusy(false);
      return;
    }
    onSaved();
    if (connect) onConnect(saved);
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
      primaryAction={{
        label: 'Connect',
        disabled: !address.trim(),
        onClick: () => void save(true),
      }}
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
          label="Password"
          hint={
            vault === 'none'
              ? 'Set up the vault to save passwords, then hosts connect in one click.'
              : vault === 'locked'
                ? 'Unlock the vault to save or change the password.'
                : passwordSaved && !forgetPassword
                  ? 'A password is saved. Type a new one to replace it.'
                  : 'Saved encrypted in your vault. Connecting will not ask for it again.'
          }
          extra={
            vault === 'none' ? (
              <button type="button" className="compact-button" onClick={onSetupVault}>
                Set up vault
              </button>
            ) : passwordSaved && !password ? (
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={forgetPassword}
                  onChange={(event) => setForgetPassword(event.target.checked)}
                />
                Remove saved password
              </label>
            ) : undefined
          }
        >
          {(props) => (
            <div className="password-input">
              <input
                {...props}
                name="password"
                type={showPassword ? 'text' : 'password'}
                maxLength={4096}
                autoComplete="new-password"
                spellCheck={false}
                disabled={vault === 'locked' || forgetPassword}
                placeholder={passwordSaved && !forgetPassword ? '•••••••• (saved)' : 'Optional'}
                value={password}
                onFocus={() => void checkVault()}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button
                type="button"
                className="icon-button"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                title={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword((value) => !value)}
              >
                <Icon name={showPassword ? 'eye-off' : 'eye'} />
              </button>
            </div>
          )}
        </Field>
        <Field
          label="SSH identity"
          hint="Optional. An identity shares one username and key or password across many hosts."
        >
          {(props) => (
            <select
              {...props}
              name="identityId"
              value={identityId}
              onChange={(event) => setIdentityId(event.target.value)}
            >
              <option value="">
                {groupIdentity
                  ? `Group default (${groupIdentity})`
                  : 'None — use the password above'}
              </option>
              {identities.map((identity) => (
                <option key={identity.id} value={identity.id}>
                  {identity.name} · {identity.username}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field
          label="Connect through (jump host)"
          hint="Optional. Connect to this saved host first, then reach this server from it (ProxyJump). The jump host needs a saved login."
        >
          {(props) => (
            <select
              {...props}
              name="jumpHostId"
              value={jumpHostId}
              onChange={(event) => setJumpHostId(event.target.value)}
            >
              <option value="">None — connect directly</option>
              {hosts
                .filter((item) => item.id !== host?.id)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.address}
                  </option>
                ))}
            </select>
          )}
        </Field>
        <Field
          label="Connect through proxy"
          hint={
            proxies.length
              ? 'Optional. With a jump host, the proxy carries the connection to the first jump host unless that host sets its own.'
              : 'Optional. Add proxies in Settings → Proxies.'
          }
        >
          {(props) => (
            <select
              {...props}
              name="proxyId"
              value={proxyId}
              onChange={(event) => setProxyId(event.target.value)}
            >
              <option value="">None — connect directly</option>
              {proxies.map((proxy) => (
                <option key={proxy.id} value={proxy.id}>
                  {proxy.name} · {describeProxy(proxy)}
                </option>
              ))}
              {proxyId && !proxies.some((proxy) => proxy.id === proxyId) && (
                <option value={proxyId}>Saved proxy</option>
              )}
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
      <EnvironmentFields
        entries={environment}
        onChange={setEnvironment}
        inherited={inherited.environment ?? []}
      />
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
  const [environment, setEnvironment] = useState(group?.environment ?? []);
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
        environment,
      });
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message.startsWith('Environment')
          ? cause.message
          : cause instanceof Error && cause.message === 'Invalid group path.'
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
        'Unable to save the group. Check the parent group, the 32-variable inherited limit for descendant hosts, and local storage.',
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
      <EnvironmentFields entries={environment} onChange={setEnvironment} />
    </SidePanel>
  );
}
