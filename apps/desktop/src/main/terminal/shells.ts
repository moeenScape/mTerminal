import { access, readFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import type { ShellInfo } from '../../shared/terminal.js';

export async function executable(path: string): Promise<boolean> {
  if (!isAbsolute(path) || path.includes('\0')) return false;
  try {
    if (!(await stat(path)).isFile()) return false;
    await access(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
export async function discoverShells(): Promise<ShellInfo[]> {
  const candidates: string[] = [];
  if (process.env.SHELL) candidates.push(process.env.SHELL);
  if (process.platform === 'win32') {
    if (process.env.ComSpec) candidates.push(process.env.ComSpec);
    const root = process.env.SystemRoot || 'C:\\Windows';
    candidates.push(
      join(root, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      join(root, 'System32/cmd.exe'),
    );
    if (process.env.ProgramFiles)
      candidates.push(join(process.env.ProgramFiles, 'PowerShell/7/pwsh.exe'));
  } else {
    try {
      if ((await stat('/etc/shells')).size <= 65536) {
        candidates.push(
          ...(await readFile('/etc/shells', 'utf8'))
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith('#')),
        );
      }
    } catch {
      /* Standard paths remain available when /etc/shells is absent. */
    }
    candidates.push('/bin/bash', '/bin/zsh', '/bin/sh', '/usr/bin/fish');
  }
  const shells: ShellInfo[] = [];
  for (const path of new Set(candidates)) {
    if (await executable(path)) shells.push({ path, name: basename(path) });
  }
  return shells;
}
export async function chooseShell(override: string): Promise<string> {
  if (override) {
    if (!(await executable(override))) throw new Error('Configured shell is unavailable.');
    return override;
  }
  const shells = await discoverShells();
  if (!shells[0]) throw new Error('No executable shell is available.');
  return shells[0].path;
}
