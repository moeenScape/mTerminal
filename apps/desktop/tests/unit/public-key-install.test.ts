import { describe, expect, it } from 'vitest';
import { prepareAuthorizedKeys } from '../../src/main/terminal/install-public-key.js';
import { appendAuthorizedKey } from '../../src/main/terminal/install-public-key.js';
import type { SFTPWrapper, Stats } from 'ssh2';
import { utils } from 'ssh2';
import { formatSshPublicKey } from '../../src/shared/ssh.js';

describe('public-key installation file update', () => {
  it('formats the SSH wire key blob as a standard authorized_keys line', () => {
    const generated = utils.generateKeyPairSync('ed25519');
    const parsed = utils.parseKey(generated.private);
    if (parsed instanceof Error || Array.isArray(parsed)) throw new Error('Key generation failed.');
    const line = formatSshPublicKey(parsed.type, parsed.getPublicSSH(), 'fixture key');
    expect(line).toMatch(/^ssh-ed25519 [A-Za-z0-9+/=]+ fixture key$/);
    expect(utils.parseKey(line)).not.toBeInstanceOf(Error);
  });

  it('preserves existing lines and adds the key once with a newline', () => {
    const existing = 'ssh-ed25519 AAAAexisting existing-key';
    const key = 'ssh-ed25519 AAAAnew new-key';
    expect(prepareAuthorizedKeys(existing, key)).toBe(`${existing}\n${key}\n`);
    expect(prepareAuthorizedKeys(`${existing}\n${key}\n`, key)).toBeUndefined();
    expect(prepareAuthorizedKeys(`${key} previous-comment\n`, key)).toBeUndefined();
  });

  it('does not duplicate a matching authorized key line', () => {
    const key = 'ssh-ed25519 AAAAnew';
    expect(prepareAuthorizedKeys(`${key}\nother-key\n`, key)).toBeUndefined();
  });

  it('creates the remote files securely and preserves existing authorized keys', async () => {
    const files = new Map([['/home/deploy/.ssh/authorized_keys', 'ssh-ed25519 AAAAold old-key\n']]);
    const directories = new Set(['/home/deploy']);
    const modes = new Map<string, number>();
    const missing = () => Object.assign(new Error('missing'), { code: 'ENOENT' });
    const sftp = {
      lstat(path: string, callback: (error: Error | undefined, stats: Stats) => void) {
        if (directories.has(path)) callback(undefined, { isDirectory: () => true } as Stats);
        else if (files.has(path))
          callback(undefined, {
            size: Buffer.byteLength(files.get(path)!),
            isFile: () => true,
            isDirectory: () => false,
          } as Stats);
        else callback(missing(), undefined as unknown as Stats);
      },
      mkdir(path: string, _attributes: { mode: number }, callback: (error?: Error | null) => void) {
        directories.add(path);
        callback();
      },
      chmod(path: string, mode: number, callback: (error?: Error | null) => void) {
        modes.set(path, mode);
        callback();
      },
      readFile(path: string, callback: (error: Error | undefined, contents: Buffer) => void) {
        callback(undefined, Buffer.from(files.get(path) ?? ''));
      },
      appendFile(
        path: string,
        contents: string,
        _options: { mode: number; flag: string },
        callback: (error?: Error | null) => void,
      ) {
        files.set(path, (files.get(path) ?? '') + contents);
        callback();
      },
    } as unknown as SFTPWrapper;
    const key = 'ssh-ed25519 AAAAnew new-key';

    await appendAuthorizedKey(sftp, '/home/deploy', key);
    await appendAuthorizedKey(sftp, '/home/deploy', key);

    expect(files.get('/home/deploy/.ssh/authorized_keys')).toBe(
      `ssh-ed25519 AAAAold old-key\n${key}\n`,
    );
    expect(modes).toEqual(
      new Map([
        ['/home/deploy/.ssh', 0o700],
        ['/home/deploy/.ssh/authorized_keys', 0o600],
      ]),
    );
  });
});
