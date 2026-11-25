# Administrative events

In mTerminal, open **Settings → Account → Organizations → Show organizations**. Open
**Manage** for an organization you own, then select **Show administrative events**. The
history shows the current page of up to 30 events, newest first, with the verified account
email at the time of the action, a timestamp, and what changed. Use **Show older events**
to page back and **Show newest events** to return to the latest activity.

The history records organization creation, invitations sent or renewed, cancelled, accepted
or declined, members leaving or being removed, and ownership transfers. It also records
shared vault creation, visibility changes, Reader and Editor grant changes, and successful
publications. Publications include the vault and revision. The audit record excludes vault
contents, encryption keys, write proofs, credentials, and terminal data.

The account service checks current ownership on every history request. Ownership transfer
gives the new owner access to prior history. The service writes each event in the same
PostgreSQL transaction as the corresponding change. Reads, rejected actions, and permission
saves that leave the same value produce no events. Recording starts when migration
`010_administrative_events.sql` is applied to the account database.

For manual acceptance, use two verified accounts and create an organization. Invite and
enroll the second account, create a vault, change a grant, and publish a revision. Check actor
attribution and dates in the owner’s history, then transfer ownership and confirm that the
new owner can load prior history and that the service rejects the old owner’s next request.

[Organizations](ORGANIZATIONS.md) · [Shared vaults](SHARED_VAULTS.md)
