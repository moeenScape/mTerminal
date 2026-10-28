import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clipboard, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { attachClipboard } from '../../src/main/clipboard.js';
import { clipboardChannels, MAX_CLIPBOARD_TEXT, preparePaste } from '../../src/shared/clipboard.js';
import type { DiagnosticLog } from '../../src/main/diagnostics.js';

vi.mock('electron', () => ({
  clipboard: { readText: vi.fn(), writeText: vi.fn() },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}));
beforeEach(() => vi.resetAllMocks());
function setup() {
  const frame = { url: 'file:///app/index.html' };
  const owner = { mainFrame: frame, isDestroyed: () => false };
  const focused = vi.fn(() => true);
  const once = vi.fn();
  const record = vi.fn();
  attachClipboard(
    { webContents: owner, isFocused: focused, once } as unknown as BrowserWindow,
    frame.url,
    { record } as unknown as DiagnosticLog,
  );
  const event = { sender: owner, senderFrame: frame } as unknown as IpcMainInvokeEvent;
  const handler = (channel: string) =>
    vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)![1];
  return {
    event,
    frame,
    focused,
    record,
    once,
    read: handler(clipboardChannels.read),
    write: handler(clipboardChannels.write),
  };
}

describe('paste policy', () => {
  it('preserves Unicode and indentation and confirms every line ending including a trailing newline', () => {
    expect(preparePaste('বাংলা 中文 😀\ttext').confirm).toBe(false);
    const paste = preparePaste('one\r\n  two\r');
    expect(paste.text).toBe('one\n  two\n');
    expect(paste.lines).toBe(3);
    expect(paste.confirm).toBe(true);
  });
  it('shows control characters explicitly, including bracketed-paste delimiter injection', () => {
    const paste = preparePaste('safe\x1b[201~\x03\u2028');
    expect(paste.confirm).toBe(true);
    expect(paste.preview).toContain('\\u001b[201~\\u0003\\u2028');
    expect(paste.text).toBe('safe\x1b[201~\x03\u2028');
  });
  it('bounds the preview without losing the full text or splitting an emoji', () => {
    const text = 'a'.repeat(8191) + '😀\nend';
    const paste = preparePaste(text);
    expect(paste.text).toBe(text);
    expect(paste.preview).toBe('a'.repeat(8191));
    expect(paste.truncated).toBe(true);
    expect(() => preparePaste('x'.repeat(MAX_CLIPBOARD_TEXT + 1))).toThrow();
  });
});

describe('clipboard IPC', () => {
  it('reads and writes only bounded plain text for the owning focused main frame', async () => {
    const context = setup();
    vi.mocked(clipboard.readText).mockResolvedValue('Unicode 😀');
    vi.mocked(clipboard.writeText).mockResolvedValue();
    expect(await context.read(context.event)).toEqual({ ok: true, text: 'Unicode 😀' });
    expect(await context.write(context.event, 'copied')).toEqual({ ok: true });
    expect(clipboard.writeText).toHaveBeenCalledWith('copied');
    const other = {
      ...context.event,
      senderFrame: { url: context.frame.url },
    } as unknown as IpcMainInvokeEvent;
    await expect(context.read(other)).rejects.toThrow();
    await expect(context.read(context.event, 'extra')).rejects.toThrow();
    expect(clipboard.readText).toHaveBeenCalledOnce();
  });
  it('rejects empty/oversized writes and oversized reads before forwarding contents', async () => {
    const context = setup();
    expect(await context.write(context.event, '')).toEqual({
      ok: false,
      code: 'clipboard-unavailable',
    });
    expect(await context.write(context.event, 'x'.repeat(MAX_CLIPBOARD_TEXT + 1))).toEqual({
      ok: false,
      code: 'clipboard-too-large',
    });
    expect(clipboard.writeText).not.toHaveBeenCalled();
    vi.mocked(clipboard.readText).mockResolvedValue('x'.repeat(MAX_CLIPBOARD_TEXT + 1));
    expect(await context.read(context.event)).toEqual({ ok: false, code: 'clipboard-too-large' });
  });
  it('refuses background reads and discards an asynchronous read if focus changes', async () => {
    const context = setup();
    context.focused.mockReturnValue(false);
    expect(await context.read(context.event)).toEqual({ ok: false, code: 'clipboard-unavailable' });
    expect(clipboard.readText).not.toHaveBeenCalled();
    context.focused.mockReturnValue(true);
    let complete!: (text: string) => void;
    vi.mocked(clipboard.readText).mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const reading = context.read(context.event);
    context.focused.mockReturnValue(false);
    complete('private clipboard');
    expect(await reading).toEqual({ ok: false, code: 'clipboard-unavailable' });
  });
  it('does not disclose native exception details in responses or diagnostics', async () => {
    const context = setup();
    const secret = 'password=clipboard-secret';
    vi.mocked(clipboard.readText).mockRejectedValue(new Error(secret));
    const result = await context.read(context.event);
    expect(result).toEqual({ ok: false, code: 'clipboard-unavailable' });
    expect(context.record).toHaveBeenCalledWith('clipboard-failed', 'clipboard-unavailable');
    expect(JSON.stringify([result, context.record.mock.calls])).not.toContain(secret);
    const cleanup = context.once.mock.calls[0]![1] as () => void;
    cleanup();
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(clipboardChannels.read);
  });
});
