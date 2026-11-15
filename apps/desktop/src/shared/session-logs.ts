import { validHostId } from './hosts.js';
export const MAX_SESSION_LOGS = 4;
export const MAX_LOG_CHARACTERS = 32768;
export const LOG_RETENTION_MS = 30 * 86400000;
export const sessionLogChannels = {
  list: 'session-logs:list',
  read: 'session-logs:read',
  state: 'session-logs:state',
  start: 'session-logs:start',
  stop: 'session-logs:stop',
  annotate: 'session-logs:annotate',
  delete: 'session-logs:delete',
} as const;
export const SESSION_LOGS_CHANGED = 'session-logs:changed';
export interface LogBookmark {
  id: string;
  offset: number;
  comment: string;
}
export interface LogAnnotation {
  notes: string;
  bookmarks: LogBookmark[];
}
export interface SessionLog extends LogAnnotation {
  id: string;
  sessionId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  text: string;
  reason: 'checkpoint' | 'stopped' | 'closed' | 'limit';
}
export type SessionLogSummary = Omit<SessionLog, 'text' | 'notes' | 'bookmarks'> & {
  characters: number;
};
export interface LogRecordingState {
  active: { logId: string; sessionId: string; title: string } | null;
  starting: boolean;
  message: string;
}
export interface SessionLogsApi {
  listSessionLogs: () => Promise<SessionLogSummary[]>;
  getSessionLog: (id: string) => Promise<SessionLog>;
  getLogRecordingState: () => Promise<LogRecordingState>;
  startSessionLog: (sessionId: string, title: string) => Promise<void>;
  stopSessionLog: () => Promise<void>;
  annotateSessionLog: (id: string, annotation: LogAnnotation) => Promise<void>;
  deleteSessionLog: (id: string) => Promise<void>;
  onSessionLogsChanged: (listener: () => void) => () => void;
}
export function logLabel(value: unknown, max: number, empty = false): string {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (!empty && !value.trim()) ||
    Array.from(value).some(
      (c) => c.charCodeAt(0) < 32 || (c.charCodeAt(0) >= 127 && c.charCodeAt(0) <= 159),
    )
  )
    throw new Error('Invalid session log text.');
  return value;
}
export function validateLogAnnotation(value: unknown, length: number): LogAnnotation {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid annotation.');
  const a = value as Record<string, unknown>;
  if (
    Object.keys(a).some((key) => !['notes', 'bookmarks'].includes(key)) ||
    !Array.isArray(a.bookmarks) ||
    a.bookmarks.length > 20
  )
    throw new Error('Invalid bookmarks.');
  const ids = new Set<string>();
  const bookmarks = Array.from(a.bookmarks).map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new Error('Invalid bookmark.');
    const b = item as Record<string, unknown>;
    if (
      Object.keys(b).length !== 3 ||
      !validHostId(b.id) ||
      ids.has(b.id) ||
      !Number.isSafeInteger(b.offset) ||
      Number(b.offset) < 0 ||
      Number(b.offset) > length
    )
      throw new Error('Invalid bookmark.');
    ids.add(b.id);
    return { id: b.id, offset: Number(b.offset), comment: logLabel(b.comment, 256, true) };
  });
  return { notes: logLabel(a.notes, 512, true), bookmarks };
}
export function validateSessionLog(value: unknown): SessionLog {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid session log.');
  const l = value as SessionLog;
  if (
    !validHostId(l.id) ||
    !validHostId(l.sessionId) ||
    typeof l.text !== 'string' ||
    l.text.length > MAX_LOG_CHARACTERS ||
    Array.from(l.text).some(
      (c) =>
        (c.charCodeAt(0) < 32 && c !== '\t' && c !== '\n') ||
        (c.charCodeAt(0) >= 127 && c.charCodeAt(0) <= 159),
    ) ||
    !Number.isSafeInteger(l.createdAt) ||
    !Number.isSafeInteger(l.updatedAt) ||
    l.createdAt < 0 ||
    l.updatedAt < l.createdAt ||
    !['checkpoint', 'stopped', 'closed', 'limit'].includes(l.reason)
  )
    throw new Error('Invalid session log.');
  return {
    id: l.id,
    sessionId: l.sessionId,
    title: logLabel(l.title, 100),
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
    text: l.text,
    reason: l.reason,
    ...validateLogAnnotation({ notes: l.notes, bookmarks: l.bookmarks }, l.text.length),
  };
}
export function logLineOffset(text: string, line: number): number {
  if (!Number.isSafeInteger(line) || line < 1) throw new Error('Choose a valid line number.');
  let offset = 0;
  for (let n = 1; n < line; n++) {
    const end = text.indexOf('\n', offset);
    if (end < 0) throw new Error('Choose a valid line number.');
    offset = end + 1;
  }
  return offset;
}
