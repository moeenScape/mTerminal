import { posix } from 'node:path';
import { Client, utils, type SFTPWrapper, type Stats } from 'ssh2';
import type { HostDraft } from '../../shared/hosts.js';
import { AppFailure } from '../failures.js';
import { fingerprintMatches } from './ssh.js';
import { formatSshPublicKey } from '../../shared/ssh.js';

const MAX_AUTHORIZED_KEYS_BYTES = 1024 * 1024;

export function prepareAuthorizedKeys(existing: string, publicKey: string): string | undefined {
  const key = publicKey.trim().split(/\s+/).slice(0, 2).join(' ');
  if (
    existing.split(/\r?\n/).some((line) => line.trim().split(/\s+/).slice(0, 2).join(' ') === key)
  )
    return undefined;
  return `${existing}${existing && !existing.endsWith('\n') ? '\n' : ''}${publicKey}\n`;
}

function isMissing(error: Error): boolean {
  const value = error as Error & { code?: string | number; statusCode?: number };
  return value.code === 'ENOENT' || value.code === 2 || value.statusCode === 2;
}

function callback<T>(
  run: (done: (error: Error | null | undefined, value?: T) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    run((error, value) => (error ? reject(error) : resolve(value as T)));
  });
}

async function ensureDirectory(sftp: SFTPWrapper, path: string): Promise<void> {
  let stats: Stats | undefined;
  try {
    stats = await callback((done) => sftp.lstat(path, done));
  } catch (error) {
    if (!(error instanceof Error) || !isMissing(error)) throw error;
  }
  if (!stats) await callback<void>((done) => sftp.mkdir(path, { mode: 0o700 }, done));
  else if (!stats.isDirectory()) throw new Error('Remote .ssh path is not a directory.');
  await callback<void>((done) => sftp.chmod(path, 0o700, done));
}

export async function appendAuthorizedKey(
  sftp: SFTPWrapper,
  home: string,
  publicKey: string,
): Promise<void> {
  if (!posix.isAbsolute(home)) throw new Error('Remote home directory is invalid.');
  const directory = posix.join(home, '.ssh');
  const authorizedKeys = posix.join(directory, 'authorized_keys');
  await ensureDirectory(sftp, directory);

  let stats: Stats | undefined;
  try {
    stats = await callback((done) => sftp.lstat(authorizedKeys, done));
  } catch (error) {
    if (!(error instanceof Error) || !isMissing(error)) throw error;
  }
  let existing = '';
  if (stats) {
    if (!stats.isFile() || stats.size > MAX_AUTHORIZED_KEYS_BYTES)
      throw new Error('Remote authorized_keys file is not a supported regular file.');
    const bytes = await callback<Buffer>((done) => sftp.readFile(authorizedKeys, done));
    if (bytes.length > MAX_AUTHORIZED_KEYS_BYTES)
      throw new Error('Remote authorized_keys is too large.');
    existing = bytes.toString('utf8');
  }
  const addition = prepareAuthorizedKeys(existing, publicKey);
  if (addition)
    // Append only the new line so existing remote key data is never rewritten.
    await callback<void>((done) =>
      sftp.appendFile(
        authorizedKeys,
        addition.slice(existing.length),
        { flag: 'a', mode: 0o600 },
        done,
      ),
    );
  await callback<void>((done) => sftp.chmod(authorizedKeys, 0o600, done));
}

export async function installPublicKey(
  host: HostDraft,
  username: string,
  password: string,
  expectedFingerprint: string,
  publicKeyValue: string,
): Promise<void> {
  const key = utils.parseKey(publicKeyValue);
  if (key instanceof Error || Array.isArray(key) || key.isPrivateKey())
    throw new AppFailure('ssh-key-install-failed');
  const publicKey = formatSshPublicKey(key.type, key.getPublicSSH())
    .split(/\s+/)
    .slice(0, 2)
    .join(' ');
  if (!/^(ssh-(rsa|ed25519)|ecdsa-sha2-nistp(256|384|521)) [A-Za-z0-9+/=]+$/.test(publicKey))
    throw new AppFailure('ssh-key-install-failed');

  await new Promise<void>((resolve, reject) => {
    const client = new Client();
    let settled = false;
    let mismatch = false;
    const timer = setTimeout(() => finish(new AppFailure('ssh-key-install-failed')), 20000);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.destroy();
      if (error) reject(error);
      else resolve();
    };
    client.on('error', () =>
      finish(new AppFailure(mismatch ? 'ssh-key-mismatch' : 'ssh-key-install-failed')),
    );
    client.on('close', () => {
      if (!settled)
        finish(new AppFailure(mismatch ? 'ssh-key-mismatch' : 'ssh-key-install-failed'));
    });
    client.once('ready', () => {
      client.sftp((error, sftp) => {
        if (error) return finish(new AppFailure('ssh-key-install-failed'));
        void callback<string>((done) => sftp.realpath('.', done))
          .then((home) => appendAuthorizedKey(sftp, home, publicKey))
          .then(() => finish())
          .catch(() => finish(new AppFailure('ssh-key-install-failed')));
      });
    });
    try {
      client.connect({
        host: host.address,
        port: host.port,
        username,
        password,
        readyTimeout: 15000,
        hostVerifier: (serverKey: Buffer) => {
          const accepted = fingerprintMatches(serverKey, expectedFingerprint);
          mismatch = !accepted;
          return accepted;
        },
      });
    } catch {
      finish(new AppFailure('ssh-key-install-failed'));
    }
  });
}
