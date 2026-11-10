import { isRecordableCommand } from './history.js';
export interface PathCompletion {
  prompt: number;
  command: string;
  directory: boolean;
}
export const PATH_COMPLETION_LIMIT = 20;
// shortcut: quoted/compound syntax stays with native Tab; extend only with a tested shell grammar.
export function pathCompletionContext(prefix: string) {
  if (!isRecordableCommand(prefix) || /^\s/u.test(prefix)) return;
  let word = '',
    start = 0;
  const words: string[] = [];
  for (let i = 0; i < prefix.length; i++) {
    const character = prefix[i]!;
    const code = character.charCodeAt(0);
    if (code < 32 || (code >= 127 && code <= 159) || code === 0x2028 || code === 0x2029) return;
    if (character === '\\') {
      const next = prefix[++i];
      if (
        next === undefined ||
        next.charCodeAt(0) < 32 ||
        (next.charCodeAt(0) >= 127 && next.charCodeAt(0) <= 159) ||
        next === '\u2028' ||
        next === '\u2029'
      )
        return;
      word += next;
    } else if (character === ' ') {
      if (word) words.push(word);
      word = '';
      start = i + 1;
    } else {
      if ('\'"$`|;&<>(){}*?[]!#'.includes(character)) return;
      // Tilde expansion is supported only for the current user's home at word start.
      if (character === '~' && (word !== '' || prefix[i + 1] !== '/')) return;
      word += character;
    }
  }
  // ~/ is the only expansion resolved by the main process, never by a shell command.
  if (!words.length && !word.includes('/')) return;
  if (word.startsWith('-')) return;
  const slash = word.lastIndexOf('/');
  return {
    head: word.slice(0, slash + 1),
    name: word.slice(slash + 1),
    directoriesOnly: words[0] === 'cd',
    home: prefix.slice(start, start + 2) === '~/',
  };
}
/** Append literal filename characters without enabling Bash expansion or syntax. */
export function escapePathSuffix(value: string) {
  return Array.from(value)
    .map((character) => (/[\p{L}\p{N}_.,:@%+=/-]/u.test(character) ? character : '\\' + character))
    .join('');
}
