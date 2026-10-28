import { access, readFile, stat } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chooseShell,
  shellCandidates,
  validShellPath,
  validateShellOverride,
} from '../../src/main/terminal/shells.js';

vi.mock('node:fs/promises', () => ({ access: vi.fn(), readFile: vi.fn(), stat: vi.fn() }));
const files = new Map<string, { file: boolean; accessible: boolean }>();
const preferred =
  process.platform === 'win32'
    ? 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
    : process.platform === 'darwin'
      ? '/bin/zsh'
      : '/bin/bash';
const fallback = process.platform === 'win32' ? 'C:\\Windows\\System32\\cmd.exe' : '/bin/sh';

beforeEach(() => {
  vi.resetAllMocks();
  files.clear();
  vi.stubEnv('SHELL', '');
  vi.stubEnv('PATH', '');
  vi.stubEnv('Path', '');
  vi.stubEnv('ProgramFiles', 'C:\\Program Files');
  vi.stubEnv('SystemRoot', 'C:\\Windows');
  vi.stubEnv('ComSpec', '');
  vi.stubEnv('COMSPEC', '');
  vi.mocked(readFile).mockResolvedValue('');
  vi.mocked(stat).mockImplementation(async (path) => {
    const entry = files.get(String(path));
    if (!entry && String(path) !== '/etc/shells') throw new Error('missing');
    return { size: 0, isFile: () => entry?.file ?? true } as Awaited<ReturnType<typeof stat>>;
  });
  vi.mocked(access).mockImplementation(async (path) => {
    if (!files.get(String(path))?.accessible) throw new Error('permission denied');
  });
});
afterEach(() => vi.unstubAllEnvs());

describe('platform shell policy', () => {
  it('respects Unix login shells and prefers Bash before listed sh on Linux', () => {
    expect(shellCandidates('linux', { SHELL: '/custom/fish' }, ['/bin/sh'])[0]).toBe(
      '/custom/fish',
    );
    expect(shellCandidates('linux', {}, ['/bin/sh'])[0]).toBe('/bin/bash');
    expect(shellCandidates('linux', { SHELL: '/usr/sbin/nologin' })).not.toContain(
      '/usr/sbin/nologin',
    );
  });
  it('prefers Zsh on macOS when no login-shell preference is provided', () => {
    expect(shellCandidates('darwin', {}).slice(0, 3)).toEqual(['/bin/zsh', '/bin/bash', '/bin/sh']);
  });
  it('prefers Windows PowerShell installations before ComSpec and ignores Unix SHELL', () => {
    const candidates = shellCandidates('win32', {
      ProgramFiles: 'C:\\Program Files',
      SystemRoot: 'C:\\Windows',
      ComSpec: 'C:\\Windows\\System32\\cmd.exe',
      SHELL: 'C:\\Git\\bash.exe',
      PATH: ';relative;\\rooted;"D:\\Portable Tools"',
    });
    expect(candidates).toEqual([
      'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      'D:\\Portable Tools\\pwsh.exe',
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      'C:\\Windows\\System32\\cmd.exe',
    ]);
  });
  it('deduplicates Windows paths without case sensitivity and rejects ambiguous paths/scripts', () => {
    const candidates = shellCandidates('win32', {
      SystemRoot: 'C:\\Windows',
      PATH: 'C:\\Tools;c:\\TOOLS',
    });
    expect(candidates.filter((path) => path.toLowerCase() === 'c:\\tools\\pwsh.exe')).toHaveLength(
      1,
    );
    for (const path of [
      'cmd.exe',
      'C:cmd.exe',
      '\\Windows\\cmd.exe',
      'C:\\tool.cmd',
      'C:\\tool.ps1',
      '"C:\\tool.exe"',
    ])
      expect(validShellPath(path, 'win32')).toBe(false);
    expect(validShellPath('C:\\Program Files\\PowerShell\\7\\pwsh.exe', 'win32')).toBe(true);
  });
});

describe('shell availability and overrides', () => {
  it('chooses the platform default and falls back only when it is unavailable', async () => {
    files.set(preferred, { file: true, accessible: true });
    files.set(fallback, { file: true, accessible: true });
    expect(await chooseShell('')).toBe(preferred);
    files.delete(preferred);
    expect(await chooseShell('')).toBe(fallback);
  });
  it('accepts a valid explicit path with spaces without parsing command arguments', async () => {
    const path =
      process.platform === 'win32' ? 'D:\\Custom Tools\\shell.exe' : '/custom tools/shell';
    files.set(path, { file: true, accessible: true });
    expect(await chooseShell(path)).toBe(path);
    expect(readFile).not.toHaveBeenCalled();
  });
  it('rejects missing, non-executable, and directory overrides without silently falling back', async () => {
    files.set(preferred, { file: true, accessible: true });
    const invalid = process.platform === 'win32' ? 'D:\\Bad\\shell.exe' : '/bad/shell';
    await expect(chooseShell(invalid)).rejects.toMatchObject({ code: 'shell-invalid' });
    files.set(invalid, { file: true, accessible: false });
    await expect(validateShellOverride(invalid)).rejects.toMatchObject({ code: 'shell-invalid' });
    files.set(invalid, { file: false, accessible: true });
    await expect(validateShellOverride(invalid)).rejects.toMatchObject({ code: 'shell-invalid' });
    expect(readFile).not.toHaveBeenCalled();
  });
  it('accepts an empty override and reports when no default can run', async () => {
    await expect(validateShellOverride('')).resolves.toBeUndefined();
    await expect(chooseShell('')).rejects.toMatchObject({ code: 'shell-missing' });
  });
});
