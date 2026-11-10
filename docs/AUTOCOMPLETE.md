# Autocomplete sources (F47)

F47 is in progress. History suggestions are retained; **F47.1** adds the saved-snippet source.
F47.2 adds local path completion. Command-specific argument completion (F47.3) is pending.

## Using snippet suggestions

Enable **Autocomplete** in Terminal tools or Settings. Open a supported local Bash session
and unlock the vault containing your saved snippets. Create snippets in **Terminal tools →
Snippets**. Type the beginning of a snippet's
**command**, for example `git st` for a snippet named “Inspect working tree” whose command is
`git status --short`. Names are labels, not replacement aliases. No text is erased or expanded.

Matching is case-sensitive. Eligible snippets appear first, sorted by folder/name, followed
by history in its existing ranked order, then local path matches. Exact duplicate commands appear once, preferring
the snippet's insert-only action. The combined list contains at most 20 rows and uses the
existing cursor-relative, scrollable popup. A rocket icon and **Snippet** badge identify the
source; the tooltip and accessible label include its name, folder and complete command.

- **Up/Down** selects a row; **Escape** dismisses the list. Tab keeps its shell behavior.
- **Right Arrow** or clicking inserts the remaining suffix for either source.
- **Enter on a selected snippet or path** inserts its suffix without submitting Enter. Review the
  resulting command, then press Enter again to execute it yourself.
- **Enter on selected history** retains the existing submit behavior. With nothing selected,
  Enter submits only what you typed.

Only single-line command prefixes are eligible. Multiline entries, control characters,
oversized commands and commands rejected by the existing sensitive-history filter are not
offered. The filter is a convenience and cannot recognize every credential. Multiline/manual
snippet review remains available in the Snippets tab. Space-prefixed input suppresses the
popup, preserving the existing private-command convention.

## State, privacy and failures

The snippet source reuses the existing narrow vault API. Path reads use the dedicated,
sender-validated `terminal:complete-paths` operation described below; the renderer has no
direct filesystem access.
It reads a bounded snippet snapshot once per active prompt, sharing an in-flight read as you
type. Selection rereads the catalog and requires the same snippet ID, command, displayed
name/folder, current prefix and selected ready session before inserting anything.

Edits/deletion invalidate and refresh suggestions. Vault lock clears the popup and snapshot;
late responses cannot insert old text. Changing the prefix, prompt, pane/view, session or
autocomplete preference also invalidates pending selection. Prompt changes, disabled/hidden
panes, lock and disposal clear cached snippets. Failed reads retry on a future query, allowing
unlock without a sticky failure. A changed, deleted or inaccessible snippet simply cancels
insertion. History and snippet query failures are handled independently.

Snippet contents remain encrypted on disk under the existing vault rules. Decrypted suggestions
and their snapshot stay in memory, with no new plaintext files, diagnostic logs, profiles or
workspace-export fields. History recording can remain off. Command history storage/deletion
and manual snippet execution are unchanged.

Suggestions require local Bash 5.1+ integration with `base64` and `tr`, a clean recognized prompt,
and the selected visible pane. Running programs, unsupported shells and SSH do not receive
this source. Neither source adds shell execution, an argument generator, alias replacement or multiline
insertion.

## Local path completion (F47.2)

At a recognized local Bash prompt, type a file argument such as `cat rea`, `cat ./rea`,
`cat ../rea`, `cat /tmp/rea`, or `cat ~/Doc`. Explicit paths also work in the command word
(`./bin/to`). `cd` suggestions contain directories only. Folder rows receive a trailing `/`;
files receive none. Hidden names require a dot-prefixed basename. Names beginning with `-`
require an explicit path such as `./-file`, avoiding accidental option insertion.

File/Folder badges and icons identify the source. Selecting a path with Right Arrow, click,
or highlighted Enter inserts its missing suffix without executing it. Spaces, quotes,
backslashes, dollar signs, history-expansion characters and shell metacharacters in returned
filenames are escaped literally. Escaped unquoted names can continue into subdirectories.
Existing snippets/history keep their priority and duplicate-command rules; selected history
still has its established Enter-to-run behavior.

The parser accepts simple unquoted words and backslash escapes. Quoted strings, variables,
substitutions, globs, operators, `~otheruser`, incomplete escapes and option prefixes stay
with Bash's normal Tab behavior. It never evaluates shell source or invokes a subprocess.
The combined popup remains limited to 20 entries.

The renderer supplies only session ID and typed prefix (at most 4,096 characters). The main
process requires an owned, live integrated local session and uses its validated last prompt
directory and HOME. HOME is carried privately by the Bash integration, so `~/` respects custom
shell HOME; if HOME is unavailable, this expansion has no candidates. SSH, unsupported shells,
command execution and continuation input do not authorize local path lookups. Submission,
command-start/unavailable markers, replacement prompts, exit and disposal invalidate context.

One lookup examines at most 2,048 directory entries and collects at most 40 matching file,
directory or symlink candidates. Matching symlink targets are inspected only for type; broken
links and special files are omitted. Results sort folders first, then names, and cap at 20
before merging. Large directories can have incomplete results. Control/replacement-character
names and oversized inserted commands are omitted. Missing/unreadable directories yield no
path candidates while other sources remain available. No file contents are read or written.

Each result includes a session-local prompt revision. Selection repeats the lookup and
requires the same candidate/type and prompt revision, plus unchanged local prompt,
session, prefix and UI generation. Late results are discarded after reported directory/HOME changes,
submission or closure; they are never redirected. This checks names/type, not immutable file
identity. Review the completed command before running it; files can change afterward.
No directory caches, plaintext logs, profile/export fields or storage migrations are added.

## Verification boundary

Regression tests cover source ordering, deduplication, bounds, unsafe-command exclusion,
exact saved-content revalidation, mixed history/snippet UI behavior, insert-only Enter,
edit/delete refresh and a delayed acceptance after vault lock. Path regression code also
covers parsing/escaping, hidden/option-like names, cwd/HOME resolution, symlinks, traversal
bounds and iterator closure, IPC ownership/arity, invalidated prompts, delayed lookup
refusal and insert-only file/folder UI behavior. Tests are written and
type-checked; execution is deferred at the user's request. Live PTY/keychain, visual/
accessibility and cross-platform behavior remain pending the phase acceptance gate.
