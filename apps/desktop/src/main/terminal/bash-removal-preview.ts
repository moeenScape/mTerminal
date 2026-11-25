export const bashRemovalPreview = String.raw`
__mt_removal_targets() {
  local cwd target path child count seen
  cwd=$(builtin pwd -P && builtin printf '.') || return 1
  cwd=\${cwd%$'\n.'}
  builtin printf '\nRecursive deletion requested. Review the paths below.\n'
  for target in "$@"; do
    if [[ -z $target ]]; then
      builtin printf '  empty path\n'
      continue
    fi
    case $target in
      /*) path=$target ;;
      *) path=\${cwd%/}/$target ;;
    esac
    builtin printf '  %q\n' "$path"
    # A trailing slash must not cause the preview to list a symlink target.
    seen=\${path%"\${path##*[!/]}"}
    if [[ -n $seen && -L $seen ]]; then
      builtin printf '    symbolic link\n'
    elif [[ -d $path ]]; then
      count=0
      while IFS= builtin read -r -d '' -t 1 child; do
        if (( count == 5 )); then
          builtin printf '      … more entries\n'
          break
        fi
        builtin printf '      %q\n' "\${child##*/}"
        count=$((count + 1))
      done < <(command find -P "$path" -mindepth 1 -maxdepth 1 -print0 2>/dev/null)
      if (( count == 0 )); then
        builtin printf '      No entries shown. The directory may be empty or unreadable.\n'
      fi
    elif [[ ! -e $path ]]; then
      builtin printf '    not found or inaccessible\n'
    fi
  done
}

__mt_confirm_removal() {
  local challenge answer
  __mt_removal_targets "$@" || return 1
  [[ -v SRANDOM ]] || return 1
  builtin printf -v challenge '%08x' "$SRANDOM"
  builtin printf 'Type %s to delete, or press Enter to cancel: ' "$challenge"
  IFS= builtin read -r -t 60 answer && [[ $answer == "$challenge" ]]
} </dev/tty >/dev/tty

__mt_review_rm() {
  local arg recursive=0 force=0 options=1
  local -a targets=()
  for arg in "$@"; do
    if (( options )); then
      case $arg in
        --) options=0; continue ;;
        --f|--fo|--for|--forc|--force|--interactive=never) force=1; continue ;;
        --r|--re|--rec|--recu|--recur|--recurs|--recursi|--recursiv|--recursive) recursive=1; continue ;;
        --*) continue ;;
        -?*)
          [[ $arg == *[rR]* ]] && recursive=1
          [[ $arg == *f* ]] && force=1
          continue ;;
      esac
    fi
    targets+=("$arg")
    [[ -v POSIXLY_CORRECT ]] && options=0
  done
  if (( recursive && force && \${#targets[@]} )); then
    if (( \${#targets[@]} > 10 )); then
      builtin printf 'Deletion cancelled. Review up to 10 paths at a time.\n' >&2
      return 1
    fi
    if ! __mt_confirm_removal "\${targets[@]}"; then
      builtin printf '\nDeletion cancelled.\n' >&2
      return 1
    fi
  fi
  builtin command rm "$@"
}

# Keep the user's existing rm aliases and functions in charge of their command.
if [[ $OSTYPE == linux* && -v SRANDOM && $(builtin type -t rm) == file ]]; then
  builtin alias rm=__mt_review_rm
fi
`.replaceAll('\\${', '${');
