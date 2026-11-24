# Live terminal viewing (F70)

An organization vault owner or editor can invite one teammate to watch an open terminal.
The teammate must already have access to that vault and sign in using the invited email
address. The invitation grants live viewing access to that one share.

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
joining. Earlier terminal scrollback, keystrokes, clipboard commands, and full-screen
terminal rendering are outside this step. The host keeps typing in their own terminal.
The viewer cannot send input through the relay.

The desktop generates a separate key for each invitation and seals output with the room
and frame sequence as context. The relay receives ciphertext and authorization metadata.
It keeps a bounded buffer in memory on one server process. A share lasts up to 30 minutes
and expires if the host stops reaching the relay for 15 seconds. Closing the terminal
stops capture. After permissions or a session are revoked, the service denies subsequent
requests. Copies made by a viewer before revocation remain with that viewer.

For manual verification, use two accounts with vault access. Invite the second account,
confirm it sees only the selected terminal, and try the same code with a third account.
Use **Stop live share**, close the terminal, and revoke the viewer's vault grant in separate
runs. In each case verify the viewer stops receiving output. Run the written regressions
at the Phase 8 gate.

Typing ownership and hand-back remain part of F70.
