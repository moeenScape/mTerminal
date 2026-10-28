import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DiagnosticLog, LOG_LIMIT } from '../../src/main/diagnostics.js';
import { AppFailure, failureCode } from '../../src/main/failures.js';
import { failureMessages } from '../../src/shared/failures.js';

async function fixture(run: (path: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'mterminal-logs-'));
  try {
    await run(join(directory, 'diagnostics.log'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('safe diagnostics', () => {
  it('classifies failures without including arbitrary error text or payloads', async () => {
    await fixture(async (path) => {
      const secret = 'password=secret-token /private/path';
      const error = Object.assign(new Error(secret), { code: 'ENOSPC', payload: secret });
      const log = new DiagnosticLog(path);
      const code = failureCode(error, 'unexpected');
      expect(code).toBe('disk-full');
      expect(log.record('preferences-save-failed', code)).toBe(true);
      expect(log.record(secret as never)).toBe(false);
      expect(log.record('startup-failed', secret as never)).toBe(false);
      const content = await readFile(path, 'utf8');
      expect(content).not.toContain(secret);
      expect(JSON.parse(content)).toEqual({
        time: expect.any(String),
        event: 'preferences-save-failed',
        code: 'disk-full',
      });
      expect(failureCode(new AppFailure('database-locked'), 'unexpected')).toBe('database-locked');
      expect(failureMessages['database-locked']).toContain('none are running');
      expect(failureCode(new Error(secret), 'unexpected')).toBe('unexpected');
    });
  });
  it('rotates at the limit and keeps at most one previous file', async () => {
    await fixture(async (path) => {
      const log = new DiagnosticLog(path);
      await writeFile(path, 'x'.repeat(LOG_LIMIT));
      expect(log.record('startup-ready')).toBe(true);
      expect((await stat(path + '.1')).size).toBe(LOG_LIMIT);
      expect((await stat(path)).size).toBeLessThan(LOG_LIMIT);
      await writeFile(path, 'y'.repeat(LOG_LIMIT));
      expect(log.record('startup-ready')).toBe(true);
      expect((await readFile(path + '.1', 'utf8'))[0]).toBe('y');
    });
  });
  it('does not throw or leak the filesystem error when logging is unavailable', async () => {
    await fixture(async (path) => {
      await writeFile(path, 'blocking-file');
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        expect(new DiagnosticLog(join(path, 'nested.log')).record('startup-ready')).toBe(false);
        expect(consoleError).toHaveBeenCalledWith('mTerminal diagnostics unavailable.');
      } finally {
        consoleError.mockRestore();
      }
    });
  });
});

describe('SQLite failure messages', () => {
  it.each([
    [11, 'database-invalid'],
    [26, 'database-invalid'],
    [13, 'disk-full'],
    [8, 'permission-denied'],
    [5, 'database-locked'],
    [779, 'database-invalid'],
  ])('maps numeric code %s without raw error text', (errcode, expected) => {
    expect(
      failureCode({ code: 'ERR_SQLITE_ERROR', errcode, message: 'secret-path' }, 'database-open'),
    ).toBe(expected);
  });
});
