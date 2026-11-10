# Shell integration (F46)

New local **Bash 5.1 or newer** sessions with `base64` and `tr` report shell state in a compact
line above each terminal. Select an installed Bash executable in Settings and open a new tab
to use it. History recording and vault unlock are not required for this metadata.

## What the status means

- **At shell prompt**: the integrated primary prompt has finished rendering. The displayed
  directory is the shell's logical `$PWD` at that prompt.
- **Waiting for shell**: input ended the known prompt, but Bash has not confirmed command
  execution or a new primary prompt. This includes multiline continuation input.
- **Command running**: Bash emitted its pre-command marker. Interactive foreground programs
  remain in this state until the parent Bash prompt returns.
- **Last exit**: the 0–255 status paired with the latest observed command-start and subsequent
  prompt. Initial prompts have no completion status. A nonzero status is displayed as its
  actual code; mTerminal does not interpret application-specific exit codes.
- **Starting / unsupported / unavailable**: startup is pending, the selected shell has no
  integration, or usable metadata could not be decoded. Ordinary terminal input still works.

While a command runs, the directory and previous completion code remain the last reported
values. A pipeline or compound command line has one shell completion status, subject to
normal Bash settings such as `pipefail`. Background jobs can continue after a prompt returns;
this is a prompt lifecycle indicator, not a process monitor. Syntax errors or interrupts
without a matching start marker do not fabricate a new completed-command status.

## Hooks and boundaries

The existing temporary rc file sources `~/.bashrc`; no dotfiles are written. The integration
appends a marker to `PS0`, preserves existing `PROMPT_COMMAND` elements, and adds its own prompt
functions. It does not install or replace a DEBUG trap. Exit status is captured before other
prompt commands run. Bash 5.1 is the supported minimum because that version introduced
`PROMPT_COMMAND` array execution. See the [GNU Bash prompting behavior](https://www.gnu.org/software/bash/manual/html_node/Interactive-Shell-Behavior.html)
and [Bash 5.1 release notes](https://lists.gnu.org/archive/html/bug-bash/2020-11/msg00089.html).

The main process consumes private session-token OSC 777 frames and validates their structure,
directory encoding and status. It strips recording frames and raw public-marker attempts,
then forwards normalized metadata bound to the owning terminal session ID. The renderer
ignores metadata from other or closed sessions. Unknown external OSC output keeps its normal
terminal behavior. Malformed owned prompt frames invalidate stale metadata; buffers are bounded.

Command start clears the autocomplete prompt marker, so output from a running program is not
treated as an editable shell command. Existing insertion checks require an empty integrated
prompt; startup also waits for that prompt. Suggestions and recording keep their existing
preferences and credential-vault rules. Directory/state metadata remains in memory and is
cleared on exit, failure, reconnect or unmount; it is not added to logs, profiles or exports.
Native Bash history still follows the user's own Bash configuration.

## Supported scope and verification

Zsh, PowerShell, cmd and SSH do not receive automatic hook injection; additional capture
support remains CH05. Nested shells, prompt frameworks that later replace these hooks, and
filesystems with control characters or paths longer than 4,096 characters are outside the
supported metadata contract. Nested programs remain foreground work of the integrated Bash.

Metadata is informational, not authentication, proof of process termination or permission to
perform filesystem operations. A same-user program can inspect or imitate shell integration
messages. File browsing and remote execution retain their existing explicit destinations.

Regression tests cover chunked/BEL/ST frames, session isolation, malformed metadata, UTF-8 and
bounds, start/completion pairing, custom hook preservation, working-directory changes,
recording-off/locked-vault behavior, UI state transitions, split isolation and unsupported
shell input. Tests are written and type-checked; execution is deferred at the user's request.
Live PTY/prompt-framework compatibility, visual/accessibility and macOS/Windows acceptance
remain pending the phase verification gate.
