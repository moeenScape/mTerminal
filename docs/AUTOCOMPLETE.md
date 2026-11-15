# Autocomplete sources (F47)

F47 has four implemented sources: history, saved snippets (F47.1), local paths (F47.2),
and scoped command arguments (F47.3). Phase regression/runtime acceptance remains pending.

## Using snippet suggestions

Enable **Autocomplete** in Terminal tools or Settings. Open a supported local Bash session
and unlock the vault containing your saved snippets. Create snippets in **Terminal tools →
Snippets**. Type the beginning of a snippet's
**command**, for example `git st` for a snippet named “Inspect working tree” whose command is
`git status --short`. Names are labels, not replacement aliases. No text is erased or expanded.

Matching is case-sensitive. Eligible snippets appear first, sorted by folder/name, followed
by history in its existing ranked order, then argument and local path matches. Exact duplicate commands appear once, preferring
the snippet's insert-only action. The combined list contains at most 20 rows and uses the
existing cursor-relative, scrollable popup. A rocket icon and **Snippet** badge identify the
source; the tooltip and accessible label include its name, folder and complete command.

- **Up/Down** selects a row; **Escape** dismisses the list. Tab keeps its shell behavior.
- **Right Arrow** or clicking inserts the remaining suffix for either source.
- **Enter on a selected snippet, path or argument** inserts its suffix without submitting Enter. Review the
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
this source. No source adds shell execution, alias replacement or multiline insertion. Argument hints
use the static catalog below, not a command-driven generator.

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

## Command argument hints (F47.3)

Type `git st`, `git status --sh`, `npm install --save-d`, or `ls -` at a recognized local Bash
prompt. **Argument** rows use a chevron icon and show descriptions in their tooltip and
accessible label. Right Arrow, click or highlighted Enter inserts the missing text without
submitting Enter. Review it and press Enter separately to run the command.

The following static contexts are supported; this is a reference catalog, not installation,
repository, script, package or CLI-version detection.

| Context | Suggested words |
| --- | --- |
| `git ` | `status`, `log`, `diff`, `show`, `branch`, `help`, `--help`, `--version` |
| `git status ` | `--short`, `--branch`, `--porcelain`, `--ignored` |
| `git log ` | `--oneline`, `--graph`, `--all`, `--decorate`, `--stat` |
| `git diff ` | `--stat`, `--name-only`, `--name-status`, `--cached`, `--check` |
| `git show ` | `--stat`, `--name-only`, `--oneline` |
| `git branch ` | `--all`, `--remotes`, `--verbose` |
| `npm ` | `install`, `ci`, `run`, `test`, `outdated`, `list`, `help` |
| `npm install ` | `--save-dev`, `--ignore-scripts`, `--package-lock-only` |
| `npm ci ` | `--ignore-scripts`, `--no-audit` |
| `npm run ` | `--if-present`, `--silent` |
| `npm test ` | `--silent` |
| `ls ` | `-a`, `-l`, `-h`, `-d`, `-R` |

Matching is case-sensitive and retains the exact spaces already typed. Completed flags are
not offered again. Only the final word is extended, and it must belong to a listed context.
Standalone flags can precede more supported flags. Once an operand, unknown/value-taking
option, combined short flag or end-of-options `--` has been completed, this source stops.
For example, `git status --short --b` can offer `--branch`, while `git log HEAD --o`,
`git -C repo status --s`, `ls -la -` and `npm run dev -- --s` yield no argument hints.

Quoted strings, escaped words, shell operators, expansions, command paths, wrappers such as
sudo, aliases, `--option=value` and dynamic values remain outside this grammar. Native Tab
and other eligible autocomplete sources keep their existing behavior. No program is run to
load completions; Git config, npm scripts/extensions and shell completion scripts are not
inspected. Hints are recomputed against the current prefix at acceptance and share the
existing active-session, prompt, selection and preference guards. No new IPC, filesystem
reads, dependencies or persisted configuration are introduced by this source.

The catalog uses documented command options: [Git status](https://git-scm.com/docs/git-status),
[Git log](https://git-scm.com/docs/git-log), [Git diff](https://git-scm.com/docs/git-diff),
[npm install](https://docs.npmjs.com/cli/v11/commands/npm-install/),
[npm run](https://docs.npmjs.com/cli/v11/commands/npm-run/), and
[ls](https://www.gnu.org/software/coreutils/manual/html_node/ls-invocation.html).

## Verification boundary

Regression tests cover source ordering, deduplication, bounds, unsafe-command exclusion,
exact saved-content revalidation, mixed history/snippet UI behavior, insert-only Enter,
edit/delete refresh and a delayed acceptance after vault lock. Path regression code also
covers parsing/escaping, hidden/option-like names, cwd/HOME resolution, symlinks, traversal
bounds and iterator closure, IPC ownership/arity, invalidated prompts, delayed lookup
refusal and insert-only file/folder UI behavior. Argument tests cover supported contexts,
exact-prefix extension, duplicate suppression, operand/option boundaries, unsupported syntax,
prototype-key rejection, mixed-source ordering, revalidation, insert-only keyboard/click
acceptance, native Tab forwarding, running-program exclusion and disabled autocomplete. Tests are written and
type-checked; execution is deferred at the user's request. Live PTY/keychain, visual/
accessibility and cross-platform behavior remain pending the phase acceptance gate.
