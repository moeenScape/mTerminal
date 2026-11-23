# Organizations (F66)

Organizations give a group of verified mTerminal accounts a shared membership and an owner.
Open **Settings → Account → Organizations → Show organizations** while signed in.

1. Select **Create organization** to create it and become its owner.
2. Open **Manage** and invite a member using their account email. The invitation is valid for
   seven days and appears under **Your invitations** when that account signs in and refreshes
   organizations. The invite can arrive before the person creates an account. The same email
   must be verified when they sign in. The owner can cancel or replace a pending invitation.
3. The invited person can **Accept** or **Decline**. After accepting, the organization appears
   in their membership list. A member may leave and needs a new invitation to rejoin.
4. Under **Manage**, the owner can **Remove** a member or **Transfer ownership** to one. The
   previous owner stays a regular member after a transfer. The owner must transfer ownership
   before leaving.

Invitations use the in-app inbox. The account service sends email for account verification
and password recovery. It does not send an email for organization invitations. Owners can
view the member roster and outgoing invitations. An account can join up to 50 organizations.
Each organization can have up to 100 members and 100 pending invitations. The inbox shows the
100 pending invitations with the earliest expiry first.

## Access and data boundaries

The service authenticates every organization action using the existing account session.
An organization mutation runs in one PostgreSQL transaction. Owner and invitation checks
operate on that organization, including concurrent actions. Removal ends organization access
for all of the removed account's devices while preserving their personal account sessions and
workspace. This phase step stores organization names, memberships, and invitations separately
from the account's encrypted workspace and credential snapshots. Shared vault access and
credential offboarding on SSH servers are separate roadmap items.

On startup, migration `006_organizations.sql` adds the organization tables. For manual
acceptance, use two profiles signed in to different verified accounts. Keep a third account
outside the group to check invitation isolation. Verify creation, invitation expiry or
cancellation, acceptance, ownership transfer, and removal. After removal, refresh the former
member's view and verify they can still access their personal workspace.

[Account service setup](ACCOUNTS.md#run-locally) · [Shared vaults](SHARED_VAULTS.md)
