import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bashHistoryRc, BashHistoryStream } from '../../src/main/terminal/bash-history.js';
import { SshSecretStore, type SafeStorageProvider } from '../../src/main/storage/secret-store.js';

const bash5 =
  process.platform !== 'win32' &&
  Number(
    spawnSync(
      '/bin/bash',
      [
        '-c',
        '(( BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 1) )); echo $?',
      ],
      {
        encoding: 'utf8',
      },
    ).stdout?.trim(),
  ) === 0;

describe('command history', () => {
  it('handles split protocol frames and never treats another token as history', () => {
    const records: string[][] = [];
    const parser = new BashHistoryStream(
      'fixture',
      (command, directory) => records.push([command, directory]),
      '04e9f162-d3cd-4c8f-a70a-2323a1751a9b',
    );
    const encoded = (value: string) => Buffer.from(value).toString('base64');
    const frame = `\x1b]777;fixture;H;${encoded('/tmp')};${encoded('echo hello')}\x07`;
    expect(parser.feed(`before${frame.slice(0, 4)}`)).toBe('before');
    expect(parser.feed(`${frame.slice(4)}after`)).toBe('after');
    parser.feed(frame.replace('fixture', 'untrusted'));
    expect(parser.feed('\x1b]777;mterminal;L3RtcA==\x07')).toBe('');
    expect(records).toEqual([['echo hello', '/tmp']]);
    expect(parser.feed(`\x1b]777;fixture;P;${encoded('/tmp')}\x07`)).toBe(
      `\x1b]777;mterminal;04e9f162-d3cd-4c8f-a70a-2323a1751a9b;P;${encoded('/tmp')};?\x07`,
    );
  });

  it.skipIf(!bash5)(
    'captures actual Bash commands and excludes space-prefixed commands',
    async () => {
      const rc = await bashHistoryRc();
      const home = await mkdtemp(join(tmpdir(), 'mterminal-history-home-'));
      try {
        const result = spawnSync('/bin/bash', ['--rcfile', rc.path, '-i'], {
          input: 'echo recorded\n echo private\nexit\n',
          encoding: 'utf8',
          timeout: 5000,
          env: { ...process.env, HOME: home, HISTFILE: '/dev/null', HISTTIMEFORMAT: '', PS1: '$ ' },
        });
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(0);
        const records: string[] = [];
        new BashHistoryStream(
          rc.token,
          (command) => records.push(command),
          '04e9f162-d3cd-4c8f-a70a-2323a1751a9b',
        ).feed(result.stdout);
        expect(records).toContain('echo recorded');
        expect(records).not.toContain('echo private');
      } finally {
        await rc.dispose();
        await rm(home, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(!bash5)(
    'reports real Bash command boundaries, cd and exit status while retaining user hooks',
    async () => {
      const rc = await bashHistoryRc();
      const home = await mkdtemp(join(tmpdir(), 'mterminal-shell-home-'));
      try {
        await writeFile(
          join(home, '.bashrc'),
          "PS1='user> '\nPS0='user-start '\nPROMPT_COMMAND=('printf user-hook' 'true')\ntrap ':' DEBUG\n",
        );
        const result = spawnSync(
          '/bin/bash',
          ['-c', 'exec /bin/bash --rcfile "$1" -i 2>&1', '--', rc.path],
          {
            input: 'false\ncd /\nprintf "VALUE=%s\\n" "$?"\ntrap -p DEBUG\nexit\n',
            encoding: 'utf8',
            timeout: 5000,
            env: { ...process.env, HOME: home, HISTFILE: '/dev/null', HISTTIMEFORMAT: '' },
          },
        );
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('user-start ');
        expect(result.stdout).toContain('user-hook');
        expect(result.stdout).toContain("trap -- ':' DEBUG");
        const normalized = new BashHistoryStream(
          rc.token,
          () => {},
          '04e9f162-d3cd-4c8f-a70a-2323a1751a9b',
        ).feed(result.stdout);
        expect(normalized).toContain(';C\x07');
        expect(normalized).toContain(';1\x07');
        expect(normalized).toContain(`;P;${Buffer.from('/').toString('base64')};0\x07`);
        expect(normalized).not.toContain(rc.token);
      } finally {
        await rc.dispose();
        await rm(home, { recursive: true, force: true });
      }
    },
  );

  it('encrypts history, ranks by directory, deduplicates and enforces vault locking', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mterminal-history-vault-'));
    const storage: SafeStorageProvider = {
      isAsyncEncryptionAvailable: async () => true,
      getSelectedStorageBackend: () => 'gnome_libsecret',
      encryptStringAsync: async (value) => Buffer.from(value),
      decryptStringAsync: async (value) => ({ result: value.toString(), shouldReEncrypt: false }),
    };
    try {
      const store = new SshSecretStore(directory, storage, 'linux');
      await store.setupVault('command history test passphrase');
      await store.recordCommand('docker ps', '/one');
      await store.recordCommand('docker logs api', '/two');
      await store.recordCommand('docker ps', '/one');
      await store.recordCommand('echo token=secret', '/one');
      const rows = await store.searchHistory('docker', '/one');
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ command: 'docker ps', uses: 2, source: 'saved' });
      expect(
        (await store.searchHistory('LOGS', '/one', 'contains')).map((row) => row.command),
      ).toEqual(['docker logs api']);
      expect(await store.searchHistory('LOGS', '/one', 'prefix')).toEqual([]);
      const { readFile } = await import('node:fs/promises');
      expect(await readFile(join(directory, 'history.enc'), 'utf8')).not.toContain('docker');
      await store.lockVault();
      await expect(store.searchHistory('', '')).rejects.toMatchObject({ code: 'vault-locked' });
      await store.unlockVault('command history test passphrase');
      await store.deleteHistory(rows[0]!.id);
      expect(await store.searchHistory('docker', '')).toHaveLength(1);
      await store.resetVault();
      await store.setupVault('a new history test passphrase');
      expect(await store.searchHistory('', '')).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
