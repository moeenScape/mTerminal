export const MAX_INPUT = 65536;
export type TerminalInput = { kind: 'text' | 'binary'; data: string };

export function validTerminalInput(value: unknown): value is TerminalInput {
  if (!value || typeof value !== 'object') return false;
  const input = value as TerminalInput;
  return (
    (input.kind === 'text' || input.kind === 'binary') &&
    typeof input.data === 'string' &&
    input.data.length > 0 &&
    input.data.length <= MAX_INPUT &&
    (input.kind === 'text' ||
      Array.from(input.data).every((character) => character.charCodeAt(0) <= 255))
  );
}

export function* terminalInputChunks(
  data: string,
  kind: TerminalInput['kind'] = 'text',
): Generator<TerminalInput> {
  let offset = 0;
  while (offset < data.length) {
    let end = Math.min(offset + MAX_INPUT, data.length);
    const last = data.charCodeAt(end - 1);
    // Do not turn an emoji into two invalid UTF-8 strings at the IPC boundary.
    if (kind === 'text' && end < data.length && last >= 0xd800 && last <= 0xdbff) end--;
    yield { kind, data: data.slice(offset, end) };
    offset = end;
  }
}
