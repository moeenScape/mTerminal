import { open, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  HISTORY_RESULT_LIMIT,
  historyMatches,
  isRecordableCommand,
  type CommandHistoryEntry,
  type HistorySearchMode,
} from '../../shared/history.js';

/** Only the end of a large history file is read; that is where recent commands are. */
const MAX_BYTES = 1024 * 1024;
const MAX_COMMANDS = 5000;

export function bashHistoryPath(env: NodeJS.ProcessEnv = process.env) {
  return env.HISTFILE || join(homedir(), '.bash_history');
}

/**
 * Unique commands from Bash's history file, newest first. Timestamp comment lines
 * (`#1700000000`, written when HISTTIMEFORMAT is set) and filtered commands are skipped.
 */
export function parseBashHistory(content: string): string[] {
  const seen = new Set<string>();
  const commands: string[] = [];
  const lines = content.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0 && commands.length < MAX_COMMANDS; index--) {
    const line = lines[index]!.trimEnd();
    if (/^#\d+$/.test(line) || !isRecordableCommand(line) || seen.has(line)) continue;
    seen.add(line);
    commands.push(line);
  }
  return commands;
}

/**
 * Saved (vault) matches first, already ranked, then matching Bash history commands that are
 * not already listed, newest first. Bash entries cannot be deleted from mTerminal.
 */
export function mergeHistory(
  saved: CommandHistoryEntry[],
  native: string[],
  query: string,
  mode: HistorySearchMode,
): CommandHistoryEntry[] {
  const limit = HISTORY_RESULT_LIMIT[mode];
  const result = saved.slice(0, limit);
  const listed = new Set(result.map((entry) => entry.command));
  for (let index = 0; index < native.length && result.length < limit; index++) {
    const command = native[index]!;
    if (listed.has(command) || !historyMatches(command, query, mode)) continue;
    listed.add(command);
    result.push({
      id: `bash-${index}`,
      command,
      directory: '',
      lastUsed: 0,
      uses: 1,
      source: 'bash',
    });
  }
  return result;
}

/** Reads the history file again only when its size or modification time changes. */
export class BashHistoryFile {
  private cached: { key: string; commands: string[] } | undefined;
  constructor(private readonly path: string) {}

  async commands(): Promise<string[]> {
    let info;
    try {
      info = await stat(this.path);
    } catch {
      return [];
    }
    if (!info.isFile()) return [];
    const key = `${info.size}:${info.mtimeMs}`;
    if (this.cached?.key === key) return this.cached.commands;
    const handle = await open(this.path, 'r');
    try {
      const length = Math.min(info.size, MAX_BYTES);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, info.size - length);
      let text = buffer.toString('utf8');
      // A partial first line is dropped when the read starts mid-file.
      if (length < info.size) text = text.slice(text.indexOf('\n') + 1);
      this.cached = { key, commands: parseBashHistory(text) };
      return this.cached.commands;
    } catch {
      return [];
    } finally {
      await handle.close();
    }
  }
}
