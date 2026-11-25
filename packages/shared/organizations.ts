import { normalizeAccountEmail, validAccountId, validDeviceLabel } from './accounts.ts';

export const ORGANIZATION_ROUTE = '/v1/organizations';

export type OrganizationAction =
  | { kind: 'status' }
  | { kind: 'create'; name: string }
  | { kind: 'accept' | 'decline'; invitationId: string }
  | { kind: 'manage' | 'leave'; organizationId: string }
  | { kind: 'invite'; organizationId: string; email: string }
  | { kind: 'cancel-invite'; organizationId: string; invitationId: string }
  | { kind: 'transfer' | 'remove'; organizationId: string; memberId: string };

export interface Organization {
  id: string;
  name: string;
  owner: boolean;
}

export interface OrganizationInvitation {
  id: string;
  organizationName: string;
  expiresAt: string;
}

export interface OrganizationRoster {
  organizationId: string;
  members: { id: string; email: string; owner: boolean }[];
  invitations: { id: string; email: string; expiresAt: string }[];
}

export interface OrganizationView {
  organizations: Organization[];
  invitations: OrganizationInvitation[];
  roster?: OrganizationRoster;
}

export function parseOrganizationAction(value: unknown): OrganizationAction | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const { kind, organizationId, memberId, invitationId, email, name } = value as Record<
    string,
    unknown
  >;
  const count = Object.keys(value).length;
  if (kind === 'status' && count === 1) return { kind };
  if (kind === 'create' && count === 2 && validDeviceLabel(name))
    return { kind, name: name.trim() };
  if ((kind === 'accept' || kind === 'decline') && count === 2 && validAccountId(invitationId))
    return { kind, invitationId };
  if (!validAccountId(organizationId)) return;
  if ((kind === 'manage' || kind === 'leave') && count === 2) return { kind, organizationId };
  if (count !== 3) return;
  if (kind === 'invite') {
    const address = normalizeAccountEmail(email);
    if (address) return { kind, organizationId, email: address };
  }
  if (kind === 'cancel-invite' && validAccountId(invitationId))
    return { kind, organizationId, invitationId };
  if ((kind === 'transfer' || kind === 'remove') && validAccountId(memberId))
    return { kind, organizationId, memberId };
}
