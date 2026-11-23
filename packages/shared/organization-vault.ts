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

export const organizationVaultRoute = (organizationId: string) =>
  `${ORGANIZATION_ROUTE}/${organizationId}/vault`;
