# Workspace templates

Open **Workspace templates** (the folder button beside New terminal) in the session strip.
The button also brings Workspace into view when you are browsing Hosts or Settings.

## Save and open

1. Arrange your local and SSH panes, resize splits, rename tabs and choose the active pane.
2. Open Workspace templates, enter a unique name, and click **Save new template**.
3. Select a saved template to review its pane names and current host destinations.
4. Click **Open layout** to add fresh, idle panes alongside existing sessions.
5. Click **Start local shell** or **Connect SSH** in each pane you want to use.

Opening a template never reconnects automatically or repeats commands. SSH starts use the
current saved host profile and existing credential/host-key checks. Local shells use the
current default shell. A saved template is a layout, not a snapshot of running processes.

The snapshot includes all session tabs in their current order, split groups, split ratios,
pane titles, host IDs and the selected pane. New session and divider IDs are generated on
every open. Existing sessions, scrollback and layouts remain intact. Restored layouts can
be resized, split and closed normally; explicitly splitting opens a new session as usual.

## Limits and deletion

Templates require a unique name of 1–64 characters. Up to 50 templates can be stored, with
at most 16 panes per template. Opening is refused if existing and restored tabs would exceed
the shared 16-pane limit; no partial layout is added.

A deleted SSH host is shown as missing and prevents opening that template. The template is
preserved; save a new layout with the correct host. Changing an existing host profile affects
future connections from its templates. Template host IDs are not historical connection details.

**Delete template** requires confirmation and removes only the saved layout. It does not close
sessions or delete hosts. Save a new uniquely named template to retain a revised arrangement;
there is no implicit overwrite. Templates are not opened automatically on app startup.

## Storage and validation

SQLite schema 7 adds `workspace_templates`; the existing migration process backs up the
previous database before upgrading. Each entry contains validated version-1 metadata, with
bounded pane counts, layout depth and JSON size. Unknown fields, command/credential fields,
invalid ratios, duplicate/orphan panes and stale hosts at save time are rejected.

Templates exclude passwords, private keys, command history, startup commands, terminal output,
working directories and runtime state. Names and host references are ordinary local metadata,
not vault-encrypted secrets. Full SQLite snapshots include templates; the existing version-1
workspace JSON export/import remains host/group/identity/trust metadata only.

Regression code covers validation, migration, persistence, idle restoration, current-session
preservation, limits, missing hosts and confirmed deletion. Test execution is deferred at the
user's request; visual, live SSH and platform acceptance remain pending.
