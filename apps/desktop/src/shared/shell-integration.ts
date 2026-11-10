import { validTerminalId } from './terminal.js';
export interface ShellIntegrationState {
  phase: 'unknown' | 'unsupported' | 'starting' | 'waiting' | 'running' | 'prompt';
  directory: string;
  lastExitCode: number | null;
}
export type ShellMarker =
  | { kind: 'running' }
  | { kind: 'unavailable' }
  | { kind: 'prompt'; directory: string; exitCode: number | null };
export function shellDirectory(encoded: string): string | undefined {
  if (encoded.length > 22000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return;
  try {
    const bytes = atob(encoded);
    if (btoa(bytes) !== encoded) return;
    const directory = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      Uint8Array.from(bytes, (c) => c.charCodeAt(0)),
    );
    if (
      !directory.startsWith('/') ||
      directory.length > 4096 ||
      Array.from(directory).some(
        (c) => c.charCodeAt(0) < 32 || (c.charCodeAt(0) >= 127 && c.charCodeAt(0) <= 159),
      )
    )
      return;
    return directory;
  } catch {
    return;
  }
}
export function shellExitCode(value: string): number | undefined {
  if (!/^(0|[1-9][0-9]{0,2})$/.test(value) || Number(value) > 255) return;
  return Number(value);
}
/** Parses only main-process-normalized shell metadata; it never grants system access. */
export function shellMarker(data: string, sessionId: string | null): ShellMarker | undefined {
  const fields = data.split(';');
  if (!validTerminalId(sessionId) || fields[0] !== 'mterminal' || fields[1] !== sessionId) return;
  if (fields.length === 3 && fields[2] === 'C') return { kind: 'running' };
  if (fields.length === 3 && fields[2] === 'U') return { kind: 'unavailable' };
  if (fields.length !== 5 || fields[2] !== 'P') return;
  const directory = shellDirectory(fields[3]!);
  const exitCode = fields[4] === '?' ? null : shellExitCode(fields[4]!);
  if (directory === undefined || exitCode === undefined) return;
  return { kind: 'prompt', directory, exitCode };
}
