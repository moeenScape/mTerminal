import { validAccountId, validDeviceLabel } from './accounts.ts';
import { ORGANIZATION_ROUTE } from './organizations.ts';
import { type SyncEnvelope } from './workspace-sync.ts';

export interface OrganizationVaultSnapshot {
  organizationId: string;
  revision: number;
  envelope: SyncEnvelope | null;
}

export interface OrganizationVaultWrite {
  expectedRevision: number;
  envelope: SyncEnvelope;
  writeProof: string;
}

export const organizationVaultRoute = (organizationId: string, vaultId?: string) =>
  vaultId === undefined
    ? `${ORGANIZATION_ROUTE}/${organizationId}/vault`
    : `${ORGANIZATION_ROUTE}/${organizationId}/vaults/${vaultId}`;

export const ORGANIZATION_VAULTS_ROUTE = `${ORGANIZATION_ROUTE}/vaults`;

export type VaultGrant = 'reader' | 'editor';
export type VaultAccess = VaultGrant | 'owner';

export interface VaultDescriptor {
  id: string;
  name: string;
  access: VaultAccess;
  allMembers: boolean;
}

export interface VaultAdministration {
  vaultId: string;
  members: { id: string; email: string; grant: VaultGrant | null }[];
}

export interface VaultAccessView {
  vaults: VaultDescriptor[];
  administration?: VaultAdministration;
}

export type VaultAccessAction =
  | { kind: 'list'; organizationId: string }
  | { kind: 'create'; organizationId: string; name: string }
  | { kind: 'manage'; organizationId: string; vaultId: string }
  | { kind: 'visibility'; organizationId: string; vaultId: string; allMembers: boolean }
  | {
      kind: 'grant';
      organizationId: string;
      vaultId: string;
      memberId: string;
      grant: VaultGrant | null;
    };

export function validVaultGrant(value: unknown): value is VaultGrant {
  return value === 'reader' || value === 'editor';
}

export function parseVaultAccessAction(value: unknown): VaultAccessAction | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const input = value as Record<string, unknown>;
  const { kind, name, allMembers, grant } = input;
  if (!validAccountId(input.organizationId)) return;
  const organizationId = input.organizationId.toLowerCase();
  const count = Object.keys(input).length;
  if (kind === 'list' && count === 2) return { kind, organizationId };
  if (kind === 'create' && count === 3 && validDeviceLabel(name))
    return { kind, organizationId, name: name.trim() };
  if (!validAccountId(input.vaultId)) return;
  const vaultId = input.vaultId.toLowerCase();
  if (kind === 'manage' && count === 3) return { kind, organizationId, vaultId };
  if (kind === 'visibility' && count === 4 && typeof allMembers === 'boolean')
    return { kind, organizationId, vaultId, allMembers };
  if (
    kind === 'grant' &&
    count === 5 &&
    validAccountId(input.memberId) &&
    (grant === null || validVaultGrant(grant))
  )
    return { kind, organizationId, vaultId, memberId: input.memberId.toLowerCase(), grant };
}
