# Live terminal sharing and typing control (F70)

An organization vault owner or editor can invite one teammate to watch an open terminal.
The teammate must already have access to that vault and sign in using the invited email
address. The invitation grants live viewing access to that one share. Each share starts with the host in control.

1. Open a terminal in **Workspace**.
2. Go to **Settings → Account → Organizations → Vaults**, select the vault, and choose
   **Choose an open terminal to share** under **Live terminal**.
3. Select the terminal, enter the teammate's account email, and choose **Start live share**.
   Confirm the terminal and recipient. New output can contain secrets. Stop sharing before
   entering credentials or displaying sensitive output.
4. Copy the invitation and give it to the invited teammate privately. The teammate opens
   **Live terminal** for the vault, enters the invitation, and selects **Join live view**.
5. Return to Workspace. The sharing banner stays visible throughout the app. Use
   **Stop live share** to stop local capture and revoke the invitation.

The viewer receives new text output and a bounded buffer of recent shared output after
joining. Earlier terminal scrollback, keystroke echo from the local UI, clipboard commands,
and full-screen terminal rendering are outside the sharing format.

## Hand off typing control

Once the teammate joins, the host can choose **Give typing control** in the sharing banner
and approve the handoff. The grant is tied to the invited account's most recently active
viewing device. Other sessions of the same account remain read-only. Vault readers can
receive an explicit typing grant when they are the invited viewer.

The guest enters one line of text and chooses **Send line** to send it and press Enter
in the host's shell. The host's interactive input is paused for that terminal while
the grant is active. The host can choose **Take back control** at any time, and the guest
can choose **Give control back**. Leaving the view or ceasing to poll for five seconds
also releases control. The host can still stop the entire share.

A hand-back drops input that has not reached the terminal. A line already delivered to
the shell can still run. Each input is encrypted for its current grant and sequence.
The relay holds at most one pending line. If a submission fails, inspect the output
before choosing whether to submit it again. Inputs are never automatically retried.

Use current desktop and account-service builds together for typing control.

The desktop generates a separate key for each invitation and seals output with the room
and frame sequence as context. The relay receives ciphertext and authorization metadata.
It keeps a bounded buffer in memory on one server process. A share lasts up to 30 minutes
and expires if the host stops reaching the relay for 15 seconds. Closing the terminal
stops capture. After permissions or a session are revoked, the service denies subsequent
requests. Copies made by a viewer before revocation remain with that viewer.

For manual verification, use two accounts with vault access. Invite the second account,
confirm it sees only the selected terminal, and try the same code with a third account.
Grant typing control, send a harmless line such as `echo handoff`, and verify local
typing into that terminal is paused. Open the invitation on a second device signed in
to the same viewer account and verify that device cannot type. Take back control and
verify host input resumes, then grant it again and return it from the viewer side.
Use **Stop live share**, close the terminal, and revoke the viewer's vault grant in
separate runs. In each case verify the viewer stops receiving output. Run the written
regressions at the Phase 8 gate.
