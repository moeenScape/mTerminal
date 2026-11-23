# Shared vaults (F67)

Each organization has one shared vault. An owner publishes its contents, and each
current member can open the vault with its key. Open **Settings → Account → Organizations**
and select **Shared vault** beside the organization.

## Publish and open

1. The owner chooses **Generate vault key** for an empty vault and saves it privately.
   Share the generated key through a trusted channel with the members who need it.
   The organization vault uses a different key format from personal workspace sync.
2. Publish a category to replace that category from the local device. The confirmation
   explains what will be shared. Other published categories are preserved. The vault
   accepts a combined document of up to 1 MiB before encryption.
3. A member opens the same organization on their device, enters the shared key, and
   selects **Open vault**. Open it again to see the latest revision.

| Category | Published contents |
| --- | --- |
| Hosts and identities | The local host, group, and SSH identity profiles, including host addresses and usernames. Host trust, stored credentials, environment variables, proxies, and agent options stay local. |
| Snippets | The local saved snippets, including command text. Review commands for embedded secrets. Startup assignments stay local. |
| Settings | Appearance, navigation shortcuts, autocomplete, and copy on select. Default shell, window settings, and history recording stay local. |

The local SSH vault must be unlocked to publish or add snippets. Imports are explicit
and applied one category at a time. Hosts and snippets are added only. A conflict leaves
that category's local records intact. Imported snippets are available to review and use
manually. Shared settings replace the four portable values after confirmation.

## Access and storage

Migration `007_organization_vault.sql` adds a revisioned encrypted snapshot per
organization. The desktop uses the workspace encryption primitives with a separate
organization context and checks the revision before import or publication. The
server verifies the live account session and the current organization membership.
It accepts writes only from the current owner and rejects stale revisions. Personal
workspace and credential sync have separate storage and access scopes.

Losing the vault key makes the existing published content unreadable. The key stays
in the vault screen while it is open. F67 provides manual key sharing and has no key
rotation workflow. Removing a member stops future downloads from the account service.
Previously imported records, copied keys, and previously downloaded ciphertext remain
with anyone who retained them. Rotating or revoking SSH credentials on servers is a
separate operation.

## Manual verification

Use two different verified accounts in the same organization. Publish each category
from the owner profile. Open it from the member profile with the key, try an incorrect
key, import each category, then remove the member and confirm the next open is denied.
Also verify that a member cannot publish, that publishing one category preserves the
others, and that an existing local conflict leaves the category unchanged. Server and
desktop regressions are included for the Phase 8 test gate.

[Organizations guide](ORGANIZATIONS.md)
