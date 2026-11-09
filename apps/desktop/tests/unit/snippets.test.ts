import { describe, expect, it } from 'vitest';
import { validateSnippet, matchingSnippets, type Snippet } from '../../src/shared/snippets.js';
const draft = {
  name: 'Deploy',
  command: '  echo ready\r\necho done\r',
  folder: 'Work/Production',
  tags: ['deploy', 'deploy', 'linux'],
};
describe('snippet validation and search', () => {
  it('preserves script indentation, normalizes line endings and deduplicates tags', () => {
    expect(validateSnippet(draft)).toEqual({
      ...draft,
      command: '  echo ready\necho done\n',
      tags: ['deploy', 'linux'],
    });
  });
  it('rejects empty/oversized commands, terminal controls, invalid folders and extra fields', () => {
    for (const command of [
      '',
      ' ',
      'x'.repeat(4097),
      'echo\x1b[201~unsafe',
      'echo\x00x',
      'echo\x03',
      'echo\u0085x',
      'echo\u2028x',
    ])
      expect(() => validateSnippet({ ...draft, command })).toThrow();
    expect(() => validateSnippet({ ...draft, folder: '../bad' })).toThrow();
    expect(() => validateSnippet({ ...draft, startup: true })).toThrow();
    expect(() => validateSnippet({ ...draft, tags: Array(1) })).toThrow();
    expect(() => validateSnippet({ ...draft, tags: Array(11).fill('tag') })).toThrow();
    expect(() => validateSnippet({ ...draft, name: 'bad\nname' })).toThrow();
  });
  it('searches names, command text, tags and descendant folders with AND matching', () => {
    const snippets: Snippet[] = [
      { ...validateSnippet(draft), id: 'one' },
      {
        name: 'Logs',
        command: 'journalctl -f',
        folder: 'Work/Staging',
        tags: ['debug'],
        id: 'two',
      },
    ];
    expect(matchingSnippets(snippets, 'LINUX ready', 'Work')).toEqual([snippets[0]]);
    expect(matchingSnippets(snippets, '', 'Work/Production')).toEqual([snippets[0]]);
    expect(matchingSnippets(snippets, 'debug', 'Work/Production')).toEqual([]);
    expect(matchingSnippets(snippets, 'logs journalctl', '')).toEqual([snippets[1]]);
  });
});
