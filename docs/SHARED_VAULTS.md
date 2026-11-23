# Shared vaults and permissions (F67–F68)

Each organization can have up to 50 named shared vaults. Open **Settings → Account → Organizations**,
choose **Vaults** beside the organization, and select **Show vaults**. The list shows the vaults
your account can access. Owners can create additional vaults.

## Publish and open

1. An owner or editor opens an empty vault, chooses **Generate vault key**, and saves
   it privately. Use a separate generated key for each vault. Share it through a
   trusted channel with the people who have access. The shared vault key has a different
   format from a personal workspace sync key.
2. Publish a category to replace that category from the local device. The confirmation
   explains what will be shared. Other published categories are preserved. The vault
   accepts a combined document of up to 1 MiB before encryption.
3. An authorized member selects the vault, enters its shared key, and chooses
   **Open vault**. Open it again to see the latest revision.

| Category | Published contents |
| --- | --- |
| Hosts and identities | The local host, group, and SSH identity profiles, including host addresses and usernames. Host trust, stored credentials, environment variables, proxies, and agent options stay local. |
| Snippets | The local saved snippets, including command text. Review commands for embedded secrets. Startup assignments stay local. |
| Settings | Appearance, navigation shortcuts, autocomplete, and copy on select. Default shell, window settings, and history recording stay local. |

The local SSH vault must be unlocked to publish or add snippets. Imports are explicit
and applied one category at a time. Hosts and snippets are added only. A conflict leaves
that category's local records intact. Imported snippets are available to review and use
manually. Shared settings replace the four portable values after confirmation.

## Manage access

An owner can use **Manage access** beside a vault to control its visibility and
assign each organization member a grant.

| Role | Allowed actions |
| --- | --- |
| Owner | Create vaults, manage grants and visibility, open the vault, and publish with the vault key. |
| Editor | Open, import, and publish with the vault key. |
| Reader | Open and import with the vault key. |

New vaults start restricted. **Allow all members to read** gives current and future
organization members Reader access. Explicit Editor grants still apply. Clearing a
grant restores the vault's default access. To revoke a member's read access in an
organization-wide vault, restrict that vault and grant access to the people who
should keep it. Owners always have management access. After a transfer, the new
owner's prior grants are cleared because ownership grants access directly.

Membership and permissions are checked on each server request. Removing or losing
membership removes that account's grants. Rejoining requires a fresh grant for a
restricted vault. Permission changes do not remove previously imported records,
copied keys, or ciphertext retained by a member. Offboarding from the organization
and revoking credentials on SSH servers are separate operations.

## Storage and upgrade

Migration `008_vault_permissions.sql` adds the vault catalog and grants. An existing
F67 vault keeps its revision, ciphertext, key, and organization-wide Reader default.
The older endpoint for the default vault also uses the new access checks. New vaults
use a separate encryption context for each vault. All writes check the current role,
the revision, and the vault's existing publication proof. Personal workspace and
credential snapshots use separate storage and access.

The key stays in the vault screen while it is open. Losing it makes the existing
published content unreadable. Key rotation is outside this workflow.

## Manual verification

Use two different verified accounts in the same organization. Create two restricted
vaults and grant the member Reader on one vault. Verify they can open that vault with
its key and the other vault stays hidden. Promote them to Editor and publish a category.
Clear their grant and verify the next read and write are denied. Then remove and reinvite
the member and verify they need a fresh grant. Upgrade a database containing an F67
vault and verify it still opens with its existing key. Server and desktop regressions
are included for the Phase 8 test gate.

[Organizations guide](ORGANIZATIONS.md)
