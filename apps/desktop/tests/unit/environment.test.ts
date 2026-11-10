import { describe, expect, it } from 'vitest';
import { validateEnvironment } from '../../src/shared/environment.js';
import {
  resolveHost,
  validateHost,
  validateGroup,
  type HostDraft,
} from '../../src/shared/hosts.js';
import { validateWorkspaceBackup } from '../../src/shared/backup.js';
const draft: HostDraft = {
  name: 'Fixture',
  address: 'example.internal',
  username: 'deploy',
  port: 22,
  protocol: 'ssh',
  groupPath: 'Work/Prod',
};
describe('SSH environment settings', () => {
  it('keeps literals, empty overrides and case-sensitive names without trimming values', () => {
    const values = [
      { name: 'APP_ENV', value: ' production ' },
      { name: '_EMPTY', value: '' },
      { name: 'app_env', value: '$(hostname); "literal" $HOME বাংলা' },
    ];
    expect(validateEnvironment(values)).toEqual(values);
    expect(validateEnvironment(undefined)).toEqual([]);
    for (const invalid of [
      null,
      {},
      Array(2),
      Array(33).fill(values[0]),
      [{ name: '', value: '' }],
      [{ name: 'A-B', value: '' }],
      [{ name: '1NAME', value: '' }],
      [{ name: 'A'.repeat(65), value: '' }],
      [{ name: 'TERM', value: 'vt100' }],
      [values[0], values[0]],
      [{ name: 'KEY', value: 'ok', password: 'private' }],
      [{ name: 'KEY', value: 1 }],
      [{ name: 'KEY', value: 'x'.repeat(1025) }],
      [{ name: 'KEY', value: 'line\nline' }],
      [{ name: 'KEY', value: '\0' }],
      [{ name: 'KEY', value: '\x1b[0m' }],
    ])
      expect(() => validateEnvironment(invalid)).toThrow('Environment');
  });
  it('merges ancestors then nearest group then host without mutating stored profiles', () => {
    const groups = [
      validateGroup({
        path: 'Work',
        port: null,
        username: null,
        environment: [
          { name: 'APP_ENV', value: 'base' },
          { name: 'BASE', value: 'kept' },
        ],
      }),
      validateGroup({
        path: 'Work/Prod',
        port: null,
        username: null,
        environment: [
          { name: 'APP_ENV', value: 'prod' },
          { name: 'CHILD', value: 'yes' },
        ],
      }),
      validateGroup({
        path: 'Workshop',
        port: null,
        username: null,
        environment: [{ name: 'UNRELATED', value: 'no' }],
      }),
    ];
    const host = validateHost({ ...draft, environment: [{ name: 'APP_ENV', value: '' }] });
    expect(resolveHost(host, groups).environment).toEqual([
      { name: 'APP_ENV', value: '' },
      { name: 'BASE', value: 'kept' },
      { name: 'CHILD', value: 'yes' },
    ]);
    expect(resolveHost({ ...host, environment: [] }, groups).environment?.[0]?.value).toBe('prod');
    expect(groups[0]?.environment?.[0]?.value).toBe('base');
    expect(host.environment).toEqual([{ name: 'APP_ENV', value: '' }]);
  });
  it('rejects malformed and oversized inherited settings through backup validation', () => {
    const backup = {
      format: 'mterminal-workspace',
      version: 1,
      exportedAt: new Date().toISOString(),
      hosts: [],
      identities: [],
      knownHosts: [],
      groups: [
        { path: 'Work', port: null, username: null, environment: [{ name: 'VALID', value: 'ok' }] },
      ],
    };
    expect(validateWorkspaceBackup(backup).groups[0]?.environment).toEqual([
      { name: 'VALID', value: 'ok' },
    ]);
    expect(() =>
      validateWorkspaceBackup({
        ...backup,
        groups: [{ ...backup.groups[0], environment: [{ name: 'BAD-NAME', value: 'private' }] }],
      }),
    ).toThrow('Environment');
    const parent = {
      ...backup.groups[0]!,
      environment: Array.from({ length: 32 }, (_, n) => ({ name: `NAME_${n}`, value: 'ok' })),
    };
    expect(() =>
      validateWorkspaceBackup({
        ...backup,
        groups: [
          parent,
          {
            path: 'Work/Prod',
            port: null,
            username: null,
            environment: [{ name: 'OVER_LIMIT', value: 'no' }],
          },
        ],
      }),
    ).toThrow('Environment');
  });
});
