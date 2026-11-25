import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { organizationVaultRoute } from '../../../../packages/shared/organization-vault.ts';
import type { SyncEnvelope } from '../../../../packages/shared/workspace-sync.ts';
import { readSharedVault, sharedVault } from '../../src/main/storage/organization-vault.js';
import {
  generateSyncKey,
  openSyncPayload,
  writeSyncPayload,
  decodeSyncKey,
  type SyncRequest,
} from '../../src/main/storage/workspace-sync.js';
import { ORGANIZATION_VAULT_KEY_PREFIX } from '../../src/shared/organization-vault.js';
import { defaultPreferences } from '../../src/shared/preferences.js';
import type { WorkspaceBackup } from '../../src/shared/backup.js';

function fixture() {
  const organizationId = randomUUID();
  const backup: WorkspaceBackup = {
    format: 'mterminal-workspace',
    version: 1,
    exportedAt: '2026-11-23T00:00:00.000Z',
    hosts: [
      {
        id: randomUUID(),
        name: 'Staging',
        address: 'private.example.com',
        port: 22,
        username: 'operator',
        protocol: 'ssh',
        environment: [{ name: 'TOKEN', value: 'local-only' }],
      },
    ],
    groups: [],
    identities: [],
    knownHosts: [
      { address: 'private.example.com', port: 22, fingerprint: 'SHA256:' + 'x'.repeat(43) },
    ],
  };
  const database = { exportWorkspace: vi.fn(() => backup), mergeSyncedWorkspace: vi.fn(() => 1) };
  const snippets = [
    { id: randomUUID(), name: 'Inspect uptime', command: 'uptime', folder: '', tags: [] },
  ];
  const secrets = {
    listSnippets: vi.fn(async () => snippets),
    mergeSharedSnippets: vi.fn(async () => 1),
  };
  const preferences = {
    preferences: {
      ...defaultPreferences,
      appearance: 'light' as const,
      defaultShell: '/local/shell',
      recordHistory: true,
    },
    applyPortableSettings: vi.fn(async () => {}),
  };
  const snapshot = { organizationId, revision: 0, envelope: null as SyncEnvelope | null };
  const vaultId = randomUUID();
  const request: SyncRequest = vi.fn(async (path, method, data) => {
    expect(path).toBe(organizationVaultRoute(organizationId, vaultId));
    if (method === 'GET') return { ...snapshot, vaultId, access: 'owner' };
    const write = data as { expectedRevision: number; envelope: SyncEnvelope; writeProof: string };
    expect(write.expectedRevision).toBe(snapshot.revision);
    expect(write.writeProof).toMatch(/^[A-Za-z0-9_-]{43}$/);
    snapshot.envelope = write.envelope;
    return { revision: ++snapshot.revision };
  });
  return { organizationId, vaultId, request, database, secrets, preferences, snapshot, snippets };
}

describe('organization vault', () => {
  it('preserves other categories on publish and authenticates organization, revision and key', async () => {
    const { organizationId, vaultId, request, database, secrets, preferences, snapshot, snippets } =
      fixture();
    const key = generateSyncKey(ORGANIZATION_VAULT_KEY_PREFIX);
    const apply = (action: Parameters<typeof sharedVault>[0]) =>
      sharedVault(action, request, database, secrets, preferences);
    const workspace = await apply({
      kind: 'publish',
      organizationId,
      vaultId,
      key,
      category: 'workspace',
      revision: 0,
    });
    expect(workspace.revision).toBe(1);
    expect(workspace.document?.workspace?.hosts[0]).not.toHaveProperty('environment');
    expect(workspace.document?.workspace?.knownHosts).toEqual([]);
    const sharedSnippets = await apply({
      kind: 'publish',
      organizationId,
      vaultId,
      key,
      category: 'snippets',
      revision: 1,
    });
    expect(sharedSnippets.document?.workspace?.hosts).toHaveLength(1);
    expect(sharedSnippets.document?.snippets).toEqual(snippets);
    expect(JSON.stringify(snapshot)).not.toContain('private.example.com');
    expect(JSON.stringify(snapshot)).not.toContain('uptime');
    const decodedKey = decodeSyncKey(key, ORGANIZATION_VAULT_KEY_PREFIX);
    expect(() =>
      openSyncPayload(
        snapshot.envelope!,
        decodedKey,
        `organization-vault:${organizationId}:${randomUUID()}`,
        2,
      ),
    ).toThrow('sync-key');
    expect(() =>
      openSyncPayload(
        snapshot.envelope!,
        decodedKey,
        `organization-vault:${organizationId}:${vaultId}`,
        1,
      ),
    ).toThrow('sync-key');
    await expect(
      apply({ kind: 'open', organizationId, vaultId, key: generateSyncKey() }),
    ).rejects.toThrow('sync-key');
    await expect(
      apply({
        kind: 'open',
        organizationId,
        vaultId,
        key: generateSyncKey(ORGANIZATION_VAULT_KEY_PREFIX),
      }),
    ).rejects.toThrow('sync-key');
  });

  it('opens legacy ciphertext with the default vault ID and blocks local publication for readers', async () => {
    const { organizationId, database, secrets, preferences } = fixture();
    const key = generateSyncKey(ORGANIZATION_VAULT_KEY_PREFIX);
    const decodedKey = decodeSyncKey(key, ORGANIZATION_VAULT_KEY_PREFIX);
    const legacyContext = `organization-vault:${organizationId}`;
    const route = organizationVaultRoute(organizationId, organizationId);
    let existing: SyncEnvelope | undefined;
    await writeSyncPayload(
      { revision: 0 },
      { version: 1, snippets: [] },
      decodedKey,
      async (_path, _method, body) => {
        existing = (body as { envelope: SyncEnvelope }).envelope;
        return { revision: 1 };
      },
      route,
      legacyContext,
      1,
    );
    const request = vi.fn(async () => ({
      organizationId,
      vaultId: organizationId,
      revision: 1,
      access: 'reader',
      envelope: existing,
    }));
    const target = { organizationId, vaultId: organizationId, key };
    await expect(
      sharedVault({ kind: 'open', ...target }, request, database, secrets, preferences),
    ).resolves.toMatchObject({ revision: 1, document: { snippets: [] } });
    await expect(
      sharedVault(
        { kind: 'publish', ...target, category: 'workspace', revision: 1 },
        request,
        database,
        secrets,
        preferences,
      ),
    ).rejects.toThrow('organization-vault-denied');
    expect(database.exportWorkspace).not.toHaveBeenCalled();
    expect(request.mock.calls).toHaveLength(2);
  });

  it('refuses a stale local import and applies only the portable settings', async () => {
    const { organizationId, vaultId, request, database, secrets, preferences } = fixture();
    const key = generateSyncKey(ORGANIZATION_VAULT_KEY_PREFIX);
    const apply = (action: Parameters<typeof sharedVault>[0]) =>
      sharedVault(action, request, database, secrets, preferences);
    const visible = await apply({
      kind: 'publish',
      organizationId,
      vaultId,
      key,
      category: 'settings',
      revision: 0,
    });
    expect(visible.document?.settings).toEqual({
      appearance: 'light',
      navigationShortcuts: true,
      autocomplete: true,
      copyOnSelect: true,
    });
    await expect(
      apply({ kind: 'import', organizationId, vaultId, key, category: 'settings', revision: 0 }),
    ).rejects.toThrow('sync-conflict');
    expect(preferences.applyPortableSettings).not.toHaveBeenCalled();
    await apply({
      kind: 'import',
      organizationId,
      vaultId,
      key,
      category: 'settings',
      revision: 1,
    });
    expect(preferences.applyPortableSettings).toHaveBeenCalledWith(visible.document?.settings);
    expect(() => readSharedVault({ version: 1, settings: { ...defaultPreferences } })).toThrow(
      'sync-format',
    );
    expect(() => readSharedVault({ version: 1, startup: [] })).toThrow('sync-format');
  });
});
