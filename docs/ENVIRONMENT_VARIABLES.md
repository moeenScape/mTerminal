# SSH environment variables (F45)

Open **New host / Edit host** or **New group / Edit group**, then use **Environment variables →
Add variable**. Enter a name and literal value and save. For example, set `APP_ENV=production`
on a group and override it with `APP_ENV=staging` on one host. The host editor can display the
values it currently inherits from its groups.

## Inheritance and validation

Values merge from the outermost parent group through each nested group, then the host.
Names are case-sensitive; the nearest matching name wins. An empty value deliberately sets
an empty string. Removing a row restores the inherited value, if one exists; it does not
remove a variable from the server's own environment. Clear all rows to inherit group values
without host overrides.

Each profile and its effective merged environment supports up to 32 variables. Names must
match `[A-Za-z_][A-Za-z0-9_]*` and be at most 64 characters. Values are single-line text of up
to 1,024 characters; control characters and duplicate names in one profile are rejected.
`TERM` is controlled by mTerminal's pseudo-terminal settings. Whitespace, quotes, dollar signs
and command-like text in values are preserved literally, without expansion or shell execution.

These are non-secret settings. Values are stored unencrypted in SQLite and included in
workspace exports, database snapshots and restores. Keep passwords, tokens and private keys
out of this section. Existing credential-vault storage remains separate.

## When values apply

The main process resolves and snapshots the settings when a new SSH connection starts.
It sends SSH environment requests before opening the interactive shell. **Run on hosts**
exec channels reuse that connection's snapshot; its existing same-account deduplication still
applies. Editing profiles or groups affects future connections; explicitly reconnect to use
new values. Local terminals, SFTP subsystems and key-installation sessions do not receive them.

No `export` command is injected into a terminal or prefixed to a command. Existing shell
startup files can override accepted values. Group deletion preserves each affected host's
effective settings when moving it to Ungrouped. Group edits that invalidate descendant
environment limits are rolled back. Workspace export/import retains the profile overrides;
old version-1 exports without environment entries remain supported. Schema v8 adds columns
with empty defaults; the existing migration backup and transaction mechanism applies.

## Remote server support

For OpenSSH, the server administrator must permit specific names in `sshd_config`, for example:

```text
AcceptEnv APP_ENV PROJECT_REGION
```

Follow the server's normal configuration validation and reload process, and reconnect.
Avoid accepting arbitrary names with a blanket wildcard. The
[OpenSSH server manual](https://man.openbsd.org/sshd_config#AcceptEnv) describes accepted names
and notes that the default does not accept client environment variables.

The installed [ssh2 client](https://github.com/mscdex/ssh2/tree/v1.17.0#client-methods) supports
`env` options for shells and exec channels. Its shell/exec implementation sends env requests
without asking for individual replies. mTerminal therefore cannot confirm acceptance:
connecting successfully does not mean the variables were installed. Check a non-secret
variable yourself in the remote shell, for example `printenv APP_ENV`. A missing or changed
value can reflect server policy or shell startup configuration; mTerminal does not bypass it.

## Verification

Regression tests cover strict validation, literal values, inheritance and empty overrides,
persistence, backup/import, schema-v7 upgrades, rollback, group deletion, SSH env requests,
PTY dimensions, exec options, and editor/IPC behavior. They are written and type-checked;
execution is deferred at the user's request. Live OpenSSH acceptance, visual/accessibility
behavior and Windows/macOS acceptance remain pending the phase verification gate.
