# Autocomplete sources (F47)

F47 is in progress. History suggestions are retained; **F47.1** adds the saved-snippet source.
Local path completion (F47.2) and command-specific argument completion (F47.3) are pending.

## Using snippet suggestions

Enable **Autocomplete** in Terminal tools or Settings. Open a supported local Bash session
and unlock the vault containing your saved snippets. Create snippets in **Terminal tools →
Snippets**. Type the beginning of a snippet's
**command**, for example `git st` for a snippet named “Inspect working tree” whose command is
`git status --short`. Names are labels, not replacement aliases. No text is erased or expanded.

Matching is case-sensitive. Eligible snippets appear first, sorted by folder/name, followed
by history in its existing ranked order. Exact duplicate commands appear once, preferring
the snippet's insert-only action. The combined list contains at most 20 rows and uses the
existing cursor-relative, scrollable popup. A rocket icon and **Snippet** badge identify the
source; the tooltip and accessible label include its name, folder and complete command.

- **Up/Down** selects a row; **Escape** dismisses the list. Tab keeps its shell behavior.
- **Right Arrow** or clicking inserts the remaining suffix for either source.
- **Enter on a selected snippet** inserts its suffix without submitting Enter. Review the
  resulting command, then press Enter again to execute it yourself.
- **Enter on selected history** retains the existing submit behavior. With nothing selected,
  Enter submits only what you typed.

Only single-line command prefixes are eligible. Multiline entries, control characters,
oversized commands and commands rejected by the existing sensitive-history filter are not
offered. The filter is a convenience and cannot recognize every credential. Multiline/manual
snippet review remains available in the Snippets tab. Space-prefixed input suppresses the
popup, preserving the existing private-command convention.

## State, privacy and failures

The renderer reuses the existing narrow vault API; there is no new IPC or filesystem access.
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
this source. This step adds no shell execution, path inspection, argument generator, alias
replacement or multiline insertion.

## Verification boundary

Regression tests cover source ordering, deduplication, bounds, unsafe-command exclusion,
exact saved-content revalidation, mixed history/snippet UI behavior, insert-only Enter,
edit/delete refresh and a delayed acceptance after vault lock. Tests are written and
type-checked; execution is deferred at the user's request. Live PTY/keychain, visual/
accessibility and cross-platform behavior remain pending the phase acceptance gate.
