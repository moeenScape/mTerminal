import type { LocalDatabase } from '../storage/database.js';
import type { TransferRecoveryRecord } from '../../shared/transfers.js';
import { validTerminalId } from '../../shared/terminal.js';
import { validTransferRequest } from './transfer-queue.js';
import { FileBrowserError } from './listing.js';

const RECOVERY_LIMIT = 256;

/** Journal entries are evidence only: never use imported paths as filesystem instructions. */
export class TransferRecoveryStore {
  constructor(private readonly database: LocalDatabase) {}

  list(): TransferRecoveryRecord[] {
    try {
      return this.database.transaction((db) => {
        const rows = db
          .prepare('SELECT id,data FROM transfer_recovery ORDER BY rowid DESC LIMIT ?')
          .all(RECOVERY_LIMIT + 1);
        if (rows.length > RECOVERY_LIMIT) throw new Error('Invalid recovery journal.');
        return rows.map((row) => {
          if (typeof row.data !== 'string' || row.data.length > 65536)
            throw new Error('Invalid recovery record.');
          const value = JSON.parse(row.data) as TransferRecoveryRecord;
          if (!validRecord(value) || value.id !== row.id)
            throw new Error('Invalid recovery record.');
          return value;
        });
      });
    } catch {
      throw new FileBrowserError('recovery-unavailable');
    }
  }

  save(record: TransferRecoveryRecord): void {
    try {
      // Validate existing entries too; a damaged journal must never be replaced with an empty one.
      const records = this.list();
      if (!validRecord(record)) throw new Error('Invalid recovery record.');
      if (records.length >= RECOVERY_LIMIT && !records.some((entry) => entry.id === record.id))
        throw new FileBrowserError('recovery-full');
      this.database.transaction((db) => {
        db.prepare(
          'INSERT INTO transfer_recovery (id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
        ).run(record.id, JSON.stringify(record));
      });
    } catch (error) {
      if (error instanceof FileBrowserError) throw error;
      throw new FileBrowserError('recovery-unavailable');
    }
  }

  forget(id: string): void {
    try {
      if (!validTerminalId(id)) throw new Error('Invalid recovery ID.');
      this.database.transaction((db) =>
        db.prepare('DELETE FROM transfer_recovery WHERE id=?').run(id),
      );
    } catch {
      throw new FileBrowserError('recovery-unavailable');
    }
  }
}

function validRecord(value: unknown): value is TransferRecoveryRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as TransferRecoveryRecord;
  const path = (item: unknown) =>
    item === null || (typeof item === 'string' && item.length <= 4096 && !item.includes('\0'));
  const info = (item: TransferRecoveryRecord['source']) =>
    item === null ||
    (item &&
      typeof item === 'object' &&
      typeof item.path === 'string' &&
      path(item.path) &&
      ['file', 'directory', 'symlink', 'other'].includes(item.kind) &&
      Number.isSafeInteger(item.size) &&
      item.size >= 0 &&
      Number.isFinite(item.modified) &&
      typeof item.permissions === 'string' &&
      item.permissions.length <= 16 &&
      typeof item.version === 'string' &&
      item.version.length <= 512 &&
      Object.keys(item).length === 6);
  const peer = record.peer;
  return !!(
    validTerminalId(record.id) &&
    validTransferRequest({
      sessionId: record.sessionId,
      title: record.title,
      direction: record.direction,
      localDirectory: record.localDirectory,
      remoteDirectory: record.remoteDirectory,
      name: record.name,
    }) &&
    ['queued', 'staging', 'backup', 'publishing', 'settled'].includes(record.phase) &&
    [
      'queued',
      'running',
      'conflict',
      'cancelling',
      'completed',
      'skipped',
      'cancelled',
      'failed',
      'uncertain',
    ].includes(record.state) &&
    path(record.partialPath) &&
    path(record.backupPath) &&
    info(record.source) &&
    info(record.destination) &&
    typeof record.updatedAt === 'string' &&
    record.updatedAt.length <= 32 &&
    Number.isFinite(Date.parse(record.updatedAt)) &&
    (peer === null ||
      (peer &&
        typeof peer === 'object' &&
        typeof peer.address === 'string' &&
        peer.address.length <= 255 &&
        Number.isInteger(peer.port) &&
        peer.port >= 1 &&
        peer.port <= 65535 &&
        typeof peer.username === 'string' &&
        peer.username.length <= 256 &&
        typeof peer.fingerprint === 'string' &&
        /^SHA256:[A-Za-z0-9+/]{43}$/.test(peer.fingerprint) &&
        Object.keys(peer).length === 4)) &&
    Object.keys(record).length === 15
  );
}
