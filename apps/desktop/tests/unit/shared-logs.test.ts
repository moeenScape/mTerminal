import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { SharedLogRequest } from '../../../../packages/shared/shared-logs.ts';
import { sharedLogs } from '../../src/main/storage/shared-logs.js';
import { generateSyncKey } from '../../src/main/storage/workspace-sync.js';
import { ORGANIZATION_VAULT_KEY_PREFIX } from '../../src/shared/organization-vault.js';
import type { SessionLog } from '../../src/shared/session-logs.js';

function fixture() {
  const target = {
    organizationId: randomUUID(),
    vaultId: randomUUID(),
    key: generateSyncKey(ORGANIZATION_VAULT_KEY_PREFIX),
  };
  const local: SessionLog = {
    id: randomUUID(),
    sessionId: randomUUID(),
    title: 'Production snapshot',
    text: 'private-log-output\nsecond line',
    reason: 'stopped',
    createdAt: 1,
    updatedAt: 2,
    notes: 'local notes stay here',
    bookmarks: [{ id: randomUUID(), offset: 0, comment: 'local bookmark' }],
  };
  return { target, local };
}

describe('encrypted shared logs', () => {
  it('shares a frozen encrypted transcript and keeps local notes and bookmarks off the wire', async () => {
    const { target, local } = fixture();
    let share: Extract<SharedLogRequest, { kind: 'share' }> | undefined;
    const date = '2026-11-23T00:00:00.000Z';
    const request = vi.fn(async (action: SharedLogRequest) => {
      if (action.kind === 'share') {
        share = action;
        return { id: action.logId };
      }
      const note =
        action.kind === 'annotate'
          ? {
              id: action.annotationId,
              envelope: action.envelope,
              author: 'editor@example.com',
              createdAt: date,
            }
          : null;
      return {
        log: {
          id: local.id,
          label: share?.label,
          transcript: share?.transcript,
          sharedAt: date,
          expiresAt: '2026-12-23T00:00:00.000Z',
          annotations: note ? [note] : [],
        },
      };
    });
    const read = vi.fn(async () => [local]);
    const confirm = vi.fn(async () => true);
    const shareAction = { ...target, kind: 'share', logId: local.id } as const;
    await expect(sharedLogs(shareAction, request, read, confirm)).resolves.toEqual({
      sharedId: local.id,
    });
    expect(confirm).toHaveBeenCalledWith(local.title);
    const onWire = JSON.stringify(share);
    for (const text of [
      local.title,
      local.text,
      local.notes,
      local.bookmarks[0]!.comment,
      target.key,
      local.sessionId,
    ])
      expect(onWire).not.toContain(text);
    expect(share?.writeProof).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const readAction = { ...target, kind: 'read', logId: local.id } as const;
    await expect(sharedLogs(readAction, request, read, confirm)).resolves.toMatchObject({
      recording: { title: local.title, text: local.text, annotations: [] },
    });
    await expect(
      sharedLogs({ ...readAction, vaultId: randomUUID() }, request, read, confirm),
    ).rejects.toThrow('sync-key');
    const note = { kind: 'bookmark', line: 2, text: 'Investigate here' } as const;
    const action = {
      ...target,
      kind: 'annotate',
      logId: local.id,
      annotationId: randomUUID(),
      note,
    } as const;
    const result = await sharedLogs(action, request, read, confirm);
    expect(result.recording?.annotations[0]).toMatchObject({
      ...note,
      author: 'editor@example.com',
    });
    expect(JSON.stringify(request.mock.calls.at(-1))).not.toContain(note.text);
    await expect(
      sharedLogs({ ...action, note: { ...note, line: 3 } }, request, read, confirm),
    ).rejects.toThrow('shared-log-line');
  });

  it('does not send a recording before confirmation or share an unfinished checkpoint', async () => {
    const { target, local } = fixture();
    const request = vi.fn(async () => ({}));
    const action = { ...target, kind: 'share', logId: local.id } as const;
    const confirm = vi.fn(async () => false);
    await expect(sharedLogs(action, request, async () => [local], confirm)).resolves.toEqual({});
    expect(request).not.toHaveBeenCalled();
    await expect(
      sharedLogs(action, request, async () => [{ ...local, reason: 'checkpoint' }], confirm),
    ).rejects.toThrow('shared-log-local');
    expect(request).not.toHaveBeenCalled();
  });
});
