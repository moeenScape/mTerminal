import { access, readFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { posix, win32 } from 'node:path';
import type { ShellInfo } from '../../shared/terminal.js';
import { AppFailure } from '../failures.js';

export function validShellPath(path: string, platform = process.platform): boolean {
  const paths = platform === 'win32' ? win32 : posix;
  if (
    !paths.isAbsolute(path) ||
    Array.from(path).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    return false;
  // Windows rooted paths such as \Windows\cmd.exe still depend on the current drive.
  if (platform === 'win32' && (paths.parse(path).root.length <= 1 || !/\.(exe|com)$/i.test(path)))
    return false;
  return !['false', 'nologin', 'false.exe', 'nologin.exe'].includes(
    paths.basename(path).toLowerCase(),
  );
}

export function shellCandidates(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  listed: string[] = [],
): string[] {
  let candidates: string[];
  if (platform === 'win32') {
    const root = env.SystemRoot || env.WINDIR || 'C:\\Windows';
    const directories = (env.PATH || env.Path || '')
      .split(';')
      .map((entry) => entry.trim().replace(/^"(.*)"$/, '$1'))
      .filter((entry) => win32.isAbsolute(entry) && win32.parse(entry).root.length > 1);
    candidates = [
      ...(env.ProgramFiles ? [win32.join(env.ProgramFiles, 'PowerShell/7/pwsh.exe')] : []),
      ...directories.map((directory) => win32.join(directory, 'pwsh.exe')),
      win32.join(root, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      env.ComSpec || env.COMSPEC || '',
      win32.join(root, 'System32/cmd.exe'),
    ];
  } else {
    const defaults =
      platform === 'darwin'
        ? ['/bin/zsh', '/bin/bash', '/bin/sh']
        : ['/bin/bash', '/usr/bin/bash', '/bin/zsh', '/usr/bin/zsh', '/bin/sh'];
    candidates = [env.SHELL || '', ...defaults, ...listed, '/usr/bin/fish'];
  }
  const seen = new Set<string>();
  return candidates.filter((path) => {
    if (!validShellPath(path, platform)) return false;
    const key = platform === 'win32' ? win32.normalize(path).toLowerCase() : path;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function executable(path: string): Promise<boolean> {
  if (!validShellPath(path)) return false;
  try {
    if (!(await stat(path)).isFile()) return false;
    await access(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function candidates(): Promise<string[]> {
  let listed: string[] = [];
  if (process.platform !== 'win32') {
    try {
      if ((await stat('/etc/shells')).size <= 65536) {
        listed = (await readFile('/etc/shells', 'utf8'))
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith('#'));
      }
    } catch {
      /* Standard paths remain available when /etc/shells is absent. */
    }
  }
  return shellCandidates(process.platform, process.env, listed);
}

export async function discoverShells(): Promise<ShellInfo[]> {
  const shells: ShellInfo[] = [];
  for (const path of await candidates()) {
    if (await executable(path))
      shells.push({ path, name: (process.platform === 'win32' ? win32 : posix).basename(path) });
  }
  return shells;
}

export async function validateShellOverride(override: string): Promise<void> {
  if (override && !(await executable(override))) throw new AppFailure('shell-invalid');
}

export async function chooseShell(override: string): Promise<string> {
  if (override) {
    await validateShellOverride(override);
    return override;
  }
  for (const path of await candidates()) {
    if (await executable(path)) return path;
  }
  throw new AppFailure('shell-missing');
}
