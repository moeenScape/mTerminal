import { describe, expect, it, vi } from 'vitest';
import { BashHistoryStream } from '../../src/main/terminal/bash-history.js';
import { shellDirectory, shellExitCode, shellMarker } from '../../src/shared/shell-integration.js';
const id = '04e9f162-d3cd-4c8f-a70a-2323a1751a9b';
const other = '14e9f162-d3cd-4c8f-a70a-2323a1751a9b';
const encoded = (value: string) => Buffer.from(value).toString('base64');
const raw = (body: string) => `\x1b]777;private;${body}\x07`;
const normalized = (body: string) => `\x1b]777;mterminal;${id};${body}\x07`;
describe('session-bound shell metadata', () => {
  it('decodes prompt, running and unavailable states without accepting foreign sessions', () => {
    expect(shellMarker(`mterminal;${id};P;${encoded('/tmp/বাংলা 😀')};?`, id)).toEqual({
      kind: 'prompt',
      directory: '/tmp/বাংলা 😀',
      exitCode: null,
    });
    expect(shellMarker(`mterminal;${id};P;${encoded('/tmp')};130`, id)).toEqual({
      kind: 'prompt',
      directory: '/tmp',
      exitCode: 130,
    });
    expect(shellMarker(`mterminal;${id};C`, id)).toEqual({ kind: 'running' });
    expect(shellMarker(`mterminal;${id};U`, id)).toEqual({ kind: 'unavailable' });
    for (const session of [null, other, '../session'])
      expect(shellMarker(`mterminal;${id};C`, session)).toBeUndefined();
    for (const body of [
      `mterminal;${id};P;${encoded('/tmp')};256`,
      `mterminal;${id};C;extra`,
      `mterminal;${id};P;${encoded('relative')};0`,
      `mterminal;${encoded('/tmp')}`,
      `mterminal;${id};P;${encoded('/tmp')};0;extra`,
    ])
      expect(shellMarker(body, id)).toBeUndefined();
  });
  it('rejects invalid UTF-8, controls, noncanonical base64, overlong and nonabsolute directories', () => {
    for (const value of [
      '',
      '../tmp',
      '/nul\0',
      '/line\nname',
      '/escape\x1b',
      '/' + 'a'.repeat(4096),
    ])
      expect(shellDirectory(encoded(value))).toBeUndefined();
    for (const value of ['L3RtcA', ' L3RtcA==', '/w==', 'a'.repeat(22001)])
      expect(shellDirectory(value)).toBeUndefined();
    expect(shellDirectory(encoded('/'))).toBe('/');
    expect(shellExitCode('255')).toBe(255);
    for (const value of ['-1', '256', '00', '0x1', '1.0', '1;C'])
      expect(shellExitCode(value)).toBeUndefined();
  });
  it('keeps initial status unknown, pairs command start with completion, and preserves the last completed status', () => {
    const record = vi.fn();
    const parser = new BashHistoryStream('private', record, id);
    expect(parser.feed(raw(`P;${encoded('/one')};0`))).toBe(normalized(`P;${encoded('/one')};?`));
    expect(parser.feed(raw('C'))).toBe(normalized('C'));
    expect(parser.feed(raw(`H;${encoded('/one')};${encoded('false')}`))).toBe('');
    expect(record).toHaveBeenCalledWith('false', '/one');
    expect(parser.feed(raw(`P;${encoded('/two')};1`))).toBe(normalized(`P;${encoded('/two')};1`));
    expect(parser.feed(raw(`P;${encoded('/two')};0`))).toBe(normalized(`P;${encoded('/two')};1`));
    expect(parser.feed(raw('C') + raw(`P;${encoded('/two')};0`))).toBe(
      normalized('C') + normalized(`P;${encoded('/two')};0`),
    );
  });
  it('handles every chunk boundary and ST terminators without exposing private metadata', () => {
    const frames = raw('C') + raw(`P;${encoded('/two')};7`).replace('\x07', '\x1b\\');
    const expected = normalized('C') + normalized(`P;${encoded('/two')};7`);
    for (let split = 0; split <= frames.length; split++) {
      const parser = new BashHistoryStream('private', vi.fn(), id);
      expect(parser.feed(frames.slice(0, split)) + parser.feed(frames.slice(split))).toBe(expected);
    }
  });
  it('drops spoofed public markers, leaves foreign OSC untouched and fails closed on malformed owned prompts', () => {
    const parser = new BashHistoryStream('private', vi.fn(), id);
    expect(parser.feed(normalized('C'))).toBe('');
    const foreign = raw('C').replace('private', 'different');
    expect(parser.feed(foreign)).toBe(foreign);
    expect(parser.feed(raw('C') + raw(`P;${encoded('/tmp')};999`))).toBe(
      normalized('C') + normalized('U'),
    );
    expect(parser.feed(raw(`P;${encoded('/tmp')};0`))).toBe(normalized(`P;${encoded('/tmp')};?`));
    expect(parser.feed(raw(`P;${encoded('/bad\npath')};0`))).toBe(normalized('U'));
    expect(parser.feed(raw('U'))).toBe(normalized('U'));
    expect(parser.feed('\x1b]777;private;' + 'x'.repeat(32769))).toBe(normalized('U'));
    expect(parser.feed('normal output')).toBe('normal output');
  });
});
