import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { failureMessages, type FailureCode } from '../shared/failures.js';

export const LOG_LIMIT = 256 * 1024;
const diagnosticEvents = [
  'startup-ready',
  'startup-failed',
  'preferences-save-failed',
  'window-state-save-failed',
  'renderer-crashed',
  'renderer-unresponsive',
  'shutdown-failed',
  'unexpected-error',
] as const;
type DiagnosticEvent = (typeof diagnosticEvents)[number];

export class DiagnosticLog {
  private readonly path: string;
  constructor(path: string) {
    this.path = path;
  }
  // Only fixed event/error codes cross this boundary: never messages, paths, stacks, or payloads.
  record(event: DiagnosticEvent, code?: FailureCode): boolean {
    if (
      !diagnosticEvents.includes(event) ||
      (code !== undefined && !Object.hasOwn(failureMessages, code))
    )
      return false;
    const line =
      JSON.stringify({ time: new Date().toISOString(), event, ...(code ? { code } : {}) }) + '\n';
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      let size = 0;
      try {
        size = statSync(this.path).size;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (size + Buffer.byteLength(line) > LOG_LIMIT) renameSync(this.path, this.path + '.1');
      appendFileSync(this.path, line, { mode: 0o600 });
      return true;
    } catch {
      console.error('mTerminal diagnostics unavailable.');
      return false;
    }
  }
}
