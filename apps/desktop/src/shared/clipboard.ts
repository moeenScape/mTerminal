export const clipboardChannels = {
  read: 'clipboard:read-text',
  write: 'clipboard:write-text',
} as const;
export const MAX_CLIPBOARD_TEXT = 1024 * 1024;
const PREVIEW_LIMIT = 8192;
export type ClipboardReadResult =
  { ok: true; text: string } | { ok: false; code: 'clipboard-unavailable' | 'clipboard-too-large' };
export type ClipboardWriteResult =
  { ok: true } | { ok: false; code: 'clipboard-unavailable' | 'clipboard-too-large' };
export function validClipboardText(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_CLIPBOARD_TEXT;
}
function control(character: string): boolean {
  const code = character.charCodeAt(0);
  return (
    (code < 32 && code !== 9 && code !== 10) ||
    (code >= 127 && code <= 159) ||
    code === 0x2028 ||
    code === 0x2029
  );
}
export interface PreparedPaste {
  text: string;
  preview: string;
  lines: number;
  truncated: boolean;
  confirm: boolean;
}
export function preparePaste(text: string): PreparedPaste {
  if (!validClipboardText(text)) throw new Error('Clipboard text exceeds the paste limit.');
  const normalized = text.replace(/\r\n?/g, '\n');
  let lines = 1;
  let confirm = false;
  for (const character of normalized) {
    if (character === '\n') {
      lines++;
      confirm = true;
    }
    if (control(character)) confirm = true;
  }
  let end = Math.min(PREVIEW_LIMIT, normalized.length);
  const last = normalized.charCodeAt(end - 1);
  if (end < normalized.length && last >= 0xd800 && last <= 0xdbff) end--;
  const preview = Array.from(normalized.slice(0, end), (character) =>
    control(character) ? `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}` : character,
  ).join('');
  return { text: normalized, preview, lines, truncated: end < normalized.length, confirm };
}
