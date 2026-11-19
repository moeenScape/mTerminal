import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { LocalDatabase } from '../../src/main/storage/database.js';
import type { WorkspaceTemplateDraft } from '../../src/shared/workspace-templates.js';
function draft(name = 'Development'): WorkspaceTemplateDraft {
  const id = randomUUID();
  return { version: 1, name, panes: [{ id, title: 'Local' }], layouts: [{ id }], activeId: id };
}
async function fixture(
  operation: (database: LocalDatabase, path: string, close: () => void) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), 'mterminal-templates-'));
  const path = join(directory, 'workspace.sqlite');
  const database = await LocalDatabase.open(path);
  let closed = false;
  const close = () => {
    if (!closed) {
      closed = true;
      database.close();
    }
  };
  try {
    await operation(database, path, close);
  } finally {
    close();
    await rm(directory, { recursive: true, force: true });
  }
}
describe('workspace template storage', () => {
  it('persists template metadata across reopen, with explicit deletion independent of hosts', async () => {
    await fixture(async (database, path, close) => {
      const host = database.saveHost({
        name: 'SSH',
        address: 'example.internal',
        port: 22,
        username: 'deploy',
        protocol: 'ssh',
      });
      const template = draft();
      template.panes[0]!.hostId = host.id;
      const saved = database.saveWorkspaceTemplate(template);
      close();
      const reopened = await LocalDatabase.open(path);
      try {
        expect(reopened.listWorkspaceTemplates()).toEqual([saved]);
        expect(() =>
          reopened.saveWorkspaceTemplate({ ...template, name: 'development' }),
        ).toThrow();
        reopened.deleteWorkspaceTemplate(saved.id);
        expect(reopened.listWorkspaceTemplates()).toEqual([]);
        expect(reopened.listHosts()).toEqual([host]);
        reopened.saveWorkspaceTemplate(template);
        reopened.deleteHost(host.id);
        expect(reopened.listWorkspaceTemplates()[0]?.panes[0]?.hostId).toBe(host.id);
        expect(() => reopened.saveWorkspaceTemplate({ ...template, name: 'Missing' })).toThrow();
      } finally {
        reopened.close();
      }
    });
  });
  it('migrates schema 6 while retaining workspace and host records', async () => {
    await fixture(async (database, path, close) => {
      const workspace = database.workspaceId;
      const host = database.saveHost({
        name: 'Kept',
        address: 'example.internal',
        port: 22,
        username: '',
        protocol: 'ssh',
      });
      database.transaction((connection) =>
        connection.exec(
          'DROP TABLE port_forwards; ALTER TABLE hosts DROP COLUMN jumpHostId; ALTER TABLE hosts DROP COLUMN environment; ALTER TABLE host_groups DROP COLUMN environment; DROP TABLE workspace_templates; DELETE FROM schema_migrations WHERE version>=7; PRAGMA user_version=6;',
        ),
      );
      close();
      const migrated = await LocalDatabase.open(path);
      try {
        expect(migrated.workspaceId).toBe(workspace);
        expect(migrated.listHosts()).toEqual([host]);
        expect(migrated.listWorkspaceTemplates()).toEqual([]);
        expect(migrated.saveWorkspaceTemplate(draft()).name).toBe('Development');
      } finally {
        migrated.close();
      }
    });
  });
  it('rejects malformed writes and excess templates without overwriting prior records', async () => {
    await fixture(async (database) => {
      const initial = draft();
      expect(() =>
        database.saveWorkspaceTemplate({ ...initial, command: 'never-store' }),
      ).toThrow();
      expect(() => database.deleteWorkspaceTemplate('../database')).toThrow();
      for (let n = 0; n < 50; n++)
        database.saveWorkspaceTemplate({ ...initial, name: `Template ${n}` });
      expect(() => database.saveWorkspaceTemplate({ ...initial, name: 'Overflow' })).toThrow();
      expect(database.listWorkspaceTemplates()).toHaveLength(50);
    });
  });
});
