# Shared session logs (F69)

Shared session logs let a team review a saved terminal recording inside an organization
vault. Open **Settings → Account → Organizations → Vaults**, select the vault, and
open it with its key. Publish a vault category first if the vault is empty.

## Share and review a recording

1. Finish a local recording in the Workspace logs panel. Open **Shared session logs**
   in the vault, choose a completed local recording, and select **Share recording**.
2. Confirm the named recording and destination vault. Review the output for passwords,
   tokens, or sensitive data before sharing. Sharing takes a snapshot of the title and
   output. Local notes and bookmarks stay on the device.
3. Use **Show shared logs** and **Open recording** to view the shared output.
   Editors and owners can add comments or bookmarks to a line. Click a bookmark's
   line number to jump to that line. The server records the verified account email
   and time for each annotation.

| Vault role | Shared log actions |
| --- | --- |
| Reader | List and open recordings and their annotations with the vault key. |
| Editor | Share completed local recordings and add bookmarks and comments. |
| Owner | Use the Editor actions and remove a shared recording and its annotations. |

Each vault can hold 20 active recordings and each recording can have 100 annotations.
Sharing a local recording again to the same vault while it is retained preserves the
existing shared copy and expiry. Annotations can be added independently by different
editors. The shared transcript stays fixed.

## Retention and access

Recordings expire 30 days after sharing. Expired recordings become unavailable
immediately, and the account service removes them and their annotations on startup
and through hourly cleanup. Owners can remove a shared copy sooner. Neither operation
changes the original local recording. Access is checked against the current vault grant
and organization membership for every service request. Cached or separately copied
content remains with its recipient.

Migration `009_shared_logs.sql` adds the shared recording and annotation tables.
Titles, transcripts, and annotation content are encrypted on the desktop with the
vault key and separate per-recording contexts. The service stores ciphertext and the
metadata it needs for retention and attribution, including annotation author emails
and timestamps.

## Manual verification

Use an owner and an editor or reader in the same vault. Share a completed recording,
then open it on the second device using the key. Add a bookmark and a comment as an
editor. Verify the Reader can read them and has no write access. Revoke access and
confirm a subsequent fetch is denied. Remove the shared copy as the owner and verify
the original recording is still present. The Phase 8 regression suite includes the
expiry and purge checks.

[Vault permissions](SHARED_VAULTS.md#manage-access) · [Local session logs](SESSION_LOGS.md)
