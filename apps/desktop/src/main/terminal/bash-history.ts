import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export async function bashHistoryRc() {
  const directory = await mkdtemp(join(tmpdir(), 'mterminal-bash-'));
  const token = randomUUID();
  const path = join(directory, 'bashrc');
  const script = String.raw`
[[ -r "$HOME/.bashrc" ]] && . "$HOME/.bashrc"
if (( BASH_VERSINFO[0] >= 5 )) && command -v base64 >/dev/null; then
  __mt_last=''
  __mt_cwd=$PWD
  __mt_marker=''
  HISTCONTROL="\${HISTCONTROL:+$HISTCONTROL:}ignorespace"
  __mt_history_capture() {
    local result=$? line number command_text
    line=$(HISTTIMEFORMAT= builtin history 1)
    if [[ $line =~ ^[[:space:]]*([0-9]+)\ \ (.*)$ ]]; then
      number=\${BASH_REMATCH[1]}
      command_text=\${BASH_REMATCH[2]}
      if [[ -n $__mt_last && $number != "$__mt_last" && \${#command_text} -le 4096 ]]; then
        printf '\033]777;TOKEN;H;%s;%s\007' "$(printf %s "$__mt_cwd" | base64 | tr -d '\n')" "$(printf %s "$command_text" | base64 | tr -d '\n')"
      fi
      __mt_last=$number
    else
      [[ -z $__mt_last ]] && __mt_last=0
    fi
    return "$result"
  }
  __mt_history_prompt() {
    local result=$? encoded_cwd
    __mt_cwd=$PWD
    [[ -n $__mt_marker ]] && PS1=\${PS1%"$__mt_marker"}
    encoded_cwd=$(printf %s "$PWD" | base64 | tr -d '\n')
    __mt_marker="\[\e]777;TOKEN;P;$encoded_cwd\a\]"
    PS1="$PS1$__mt_marker"
    return "$result"
  }
  PROMPT_COMMAND=(__mt_history_capture "\${PROMPT_COMMAND[@]}" __mt_history_prompt)
fi
`;
  try {
    // Shell expansions stay in Bash; only the generated UUID is substituted here.
    await writeFile(path, script.replaceAll('\\${', '${').replaceAll('TOKEN', token), {
      mode: 0o600,
    });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return { path, token, dispose: () => rm(directory, { recursive: true, force: true }) };
}

export class BashHistoryStream {
  private pending = '';
  constructor(
    private readonly token: string,
    private readonly record: (command: string, directory: string) => void,
  ) {}

  feed(data: string): string {
    this.pending += data;
    let output = '';
    const prefix = '\x1b]777;';
    while (this.pending) {
      const start = this.pending.indexOf(prefix);
      if (start < 0) {
        let tail = 0;
        for (let length = 1; length < prefix.length; length++)
          if (this.pending.endsWith(prefix.slice(0, length))) tail = length;
        output += this.pending.slice(0, this.pending.length - tail);
        this.pending = this.pending.slice(this.pending.length - tail);
        break;
      }
      output += this.pending.slice(0, start);
      this.pending = this.pending.slice(start);
      const bell = this.pending.indexOf('\x07', prefix.length);
      const terminator = this.pending.indexOf('\x1b\\', prefix.length);
      const end = bell < 0 ? terminator : terminator < 0 ? bell : Math.min(bell, terminator);
      if (end < 0) {
        if (this.pending.length > 32768) this.pending = '';
        break;
      }
      const [token, kind, encodedDirectory, encodedCommand] = this.pending
        .slice(prefix.length, end)
        .split(';');
      const frame = this.pending.slice(0, end + (end === terminator ? 2 : 1));
      this.pending = this.pending.slice(frame.length);
      if (token !== this.token && token !== 'mterminal') {
        output += frame;
        continue;
      }
      if (token !== this.token || !encodedDirectory || !/^[A-Za-z0-9+/=]+$/.test(encodedDirectory))
        continue;
      const directory = Buffer.from(encodedDirectory, 'base64').toString('utf8');
      if (directory.length > 4096) continue;
      if (kind === 'P') output += `\x1b]777;mterminal;${encodedDirectory}\x07`;
      if (kind === 'H' && encodedCommand && /^[A-Za-z0-9+/=]+$/.test(encodedCommand))
        this.record(Buffer.from(encodedCommand, 'base64').toString('utf8'), directory);
    }
    return output;
  }
}
