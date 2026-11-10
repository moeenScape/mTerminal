# Broadcast input (F43)

Use **Broadcast input** in the session strip to send text to several connected SSH
sessions. Review the selected sessions and click **Start broadcast**. Starting sends
nothing. The active bar always shows the recipients, accounts, endpoints and short session
IDs; tab names distinguish sessions when available. Separate terminals on the same account
remain separate recipients. Local terminals are excluded.

## Sending and stopping

- Type or paste into **Broadcast text**. Nothing is transmitted until **Enter** or
  **Send to recipients**. Text receives a final Enter; **Shift+Enter** inserts a newline.
- Multiline text opens a preview of the exact text and recipients. Cancel sends nothing.
- **Enter all** sends only Enter. **Interrupt all (Ctrl+C)** sends the interrupt character;
  the foreground program decides how to handle it. Ctrl+C inside the text field remains Copy.
- **Stop broadcast**, **Escape** in the composer, or **Ctrl+Shift+B** / **Command+Shift+B**
  stops the mode and discards its draft. The stop shortcut also works while a review is open.

Typing, paste, snippets, startup snippets, autocomplete and protocol replies in ordinary
terminal panes keep their existing single-session destination. This feature is a deliberate
text composer; it does not mirror every keystroke, Tab completion or terminal screen state.

## Connection and delivery rules

Recipients are an immutable snapshot of authenticated SSH sessions and verified peers.
Changing the list requires stopping and starting again. Before each send, the main process
checks every session ID, account, endpoint and host-key fingerprint. Disconnecting any
recipient stops the entire mode; reconnecting never inherits old input. There is no retry.

Window blur, renderer navigation/crash, window close, leaving Workspace and vault lock/reset
also disarm the mode. Returning or unlocking does not automatically resume it. Up to 16
sessions and 4,096 characters per submitted text are supported. Input validation rejects
terminal control sequences; only the explicit Enter/Interrupt actions emit control characters.

Check the current program and prompt in each session before submitting. The same text could
be interpreted as a shell command, editor input or a password. Delivery is sequential, not
atomic: a failure may leave some recipients with input already delivered. Stop prevents
future sends but cannot undo input or guarantee termination of remote processes. Terminal
output remains in each pane; this feature does not report command completion or exit status.
Use **Run on hosts** (F42) for bounded, independent exec channels with result reporting.

Mode, draft and recipient selection are not persisted by the app, and no broadcast transcript
is logged. Remote shells/applications may record received input under their normal policies.

## Validation boundary

Regression tests cover recipient validation, stale modes, disconnects, partial failures,
control actions, IPC ownership, focus/navigation/crash/shortcut cleanup, template isolation
and UI selection/review/send/stop/navigation. They are written and type-checked, but execution
is deferred at the user's request. Live SSH, visual/accessibility and Windows/macOS behavior
remain unverified until the phase acceptance gate.
