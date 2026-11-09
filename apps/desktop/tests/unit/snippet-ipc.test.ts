import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { attachSnippets } from '../../src/main/snippets.js';
import type { SshSecretStore } from '../../src/main/storage/secret-store.js';
import { snippetChannels, SNIPPETS_CHANGED } from '../../src/shared/snippets.js';
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), removeHandler: vi.fn() } }));
beforeEach(() => vi.resetAllMocks());
function fixture() {
  const frame = { url: 'file:///app/index.html' };
  const owner = { mainFrame: frame, isDestroyed: () => false, send: vi.fn() };
  const window = { webContents: owner, once: vi.fn() };
  const secrets = {
    listSnippets: vi.fn().mockResolvedValue([]),
    saveSnippet: vi.fn().mockResolvedValue({ id: 'saved' }),
    deleteSnippet: vi.fn().mockResolvedValue(undefined),
  };
  attachSnippets(
    window as unknown as BrowserWindow,
    frame.url,
    secrets as unknown as SshSecretStore,
  );
  const handler = (channel: string) =>
    vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)![1];
  return {
    secrets,
    owner,
    window,
    event: { sender: owner, senderFrame: frame } as unknown as IpcMainInvokeEvent,
    handler,
  };
}
describe('snippet IPC boundary', () => {
  it('binds mutations to the current renderer and signals changes without sending command data', async () => {
    const { handler, event, owner, secrets } = fixture();
    const draft = { name: 'Test', command: 'echo private-command', folder: '', tags: [] };
    await expect(handler(snippetChannels.save)(event, draft, undefined)).resolves.toEqual({
      ok: true,
      value: { id: 'saved' },
    });
    expect(secrets.saveSnippet).toHaveBeenCalledWith(draft, undefined);
    expect(owner.send).toHaveBeenCalledWith(SNIPPETS_CHANGED);
    await expect(
      handler(snippetChannels.list)({
        ...event,
        senderFrame: { url: 'https://untrusted.invalid' },
      } as unknown as IpcMainInvokeEvent),
    ).rejects.toThrow();
    expect(secrets.listSnippets).not.toHaveBeenCalled();
  });
  it('rejects malformed owners/arity and returns safe failures without leaking input', async () => {
    const { handler, event, secrets, owner } = fixture();
    expect(await handler(snippetChannels.save)(event, {}, '../id')).toMatchObject({
      ok: false,
      code: 'snippet-failed',
    });
    expect(await handler(snippetChannels.delete)(event, '../id')).toMatchObject({ ok: false });
    expect(await handler(snippetChannels.list)(event, 'extra')).toMatchObject({ ok: false });
    expect(secrets.saveSnippet).not.toHaveBeenCalled();
    secrets.saveSnippet.mockRejectedValueOnce(new Error('private-command raw error'));
    const result = await handler(snippetChannels.save)(event, {}, undefined);
    expect(result).toEqual({ ok: false, code: 'snippet-failed' });
    expect(JSON.stringify(result)).not.toContain('private-command');
    expect(owner.send).not.toHaveBeenCalled();
  });
});
