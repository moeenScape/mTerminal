import { opendir, stat } from 'node:fs/promises';
import { posix } from 'node:path';
import {
  escapePathSuffix,
  pathCompletionContext,
  PATH_COMPLETION_LIMIT,
  type PathCompletion,
} from '../../shared/path-completion.js';

/** Bounded names-only reads; no subprocess, file contents or filesystem mutation. */
export async function completeLocalPaths(
  cwd: string,
  prefix: string,
  home?: string,
): Promise<Omit<PathCompletion, 'prompt'>[]> {
  const context = pathCompletionContext(prefix);
  if (!context || !posix.isAbsolute(cwd) || (context.home && (!home || !posix.isAbsolute(home))))
    return [];
  const path = context.home
    ? posix.resolve(home!, context.head.slice(2))
    : posix.resolve(cwd, context.head || '.');
  const matches: { name: string; directory: boolean; symlink: boolean }[] = [];
  try {
    const directory = await opendir(path);
    let scanned = 0;
    for await (const entry of directory) {
      if (++scanned > 2048) break;
      if (
        (!context.head && entry.name.startsWith('-')) ||
        !entry.name.startsWith(context.name) ||
        (!context.name.startsWith('.') && entry.name.startsWith('.')) ||
        Array.from(entry.name).some(
          (c) =>
            c.charCodeAt(0) < 32 ||
            (c.charCodeAt(0) >= 127 && c.charCodeAt(0) <= 159) ||
            c === '\u2028' ||
            c === '\u2029' ||
            c === '\ufffd',
        )
      )
        continue;
      if (!entry.isDirectory() && !entry.isFile() && !entry.isSymbolicLink()) continue;
      if (context.directoriesOnly && entry.isFile()) continue;
      matches.push({
        name: entry.name,
        directory: entry.isDirectory(),
        symlink: entry.isSymbolicLink(),
      });
      if (matches.length >= 40) break;
    }
    const resolved = await Promise.all(
      matches.map(async (entry) => {
        if (!entry.symlink) return entry;
        try {
          const target = await stat(posix.join(path, entry.name));
          return target.isFile() || target.isDirectory()
            ? { ...entry, directory: target.isDirectory() }
            : null;
        } catch {
          return null;
        }
      }),
    );
    return resolved
      .filter((entry) => entry !== null)
      .filter((entry) => !context.directoriesOnly || entry.directory)
      .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name))
      .flatMap((entry) => {
        const suffix =
          escapePathSuffix(entry.name.slice(context.name.length)) + (entry.directory ? '/' : '');
        const command = prefix + suffix;
        return suffix && command.length <= 4096 ? [{ command, directory: entry.directory }] : [];
      })
      .slice(0, PATH_COMPLETION_LIMIT);
  } catch {
    return [];
  }
}
