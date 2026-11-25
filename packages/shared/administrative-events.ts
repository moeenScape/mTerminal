import { normalizeAccountEmail, validAccountId, validDeviceLabel } from './accounts.ts';
import { ORGANIZATION_ROUTE } from './organizations.ts';
import { validVaultGrant, type VaultGrant } from './organization-vault.ts';
import { validSyncRevision } from './workspace-sync.ts';

export const ADMINISTRATIVE_EVENTS_ROUTE = `${ORGANIZATION_ROUTE}/events`;
export const ADMINISTRATIVE_EVENT_PAGE = 30;

type Vault = { vaultId: string; vaultName: string };
export type AdministrativeChange =
  | { kind: 'organization-created' | 'invitation-accepted' | 'invitation-declined' | 'member-left' }
  | {
      kind: 'invitation-sent' | 'invitation-cancelled' | 'member-removed' | 'ownership-transferred';
      email: string;
    }
  | ({ kind: 'vault-created' } & Vault)
  | ({ kind: 'vault-visibility'; allMembers: boolean } & Vault)
  | ({ kind: 'vault-grant'; email: string; grant: VaultGrant | null } & Vault)
  | ({ kind: 'vault-published'; revision: number } & Vault);

export interface AdministrativeEvent {
  id: string;
  actorEmail: string;
  occurredAt: string;
  change: AdministrativeChange;
}

export interface AdministrativePage {
  events: AdministrativeEvent[];
  nextBefore: string | null;
}

export interface AdministrativeQuery {
  organizationId: string;
  before?: string;
}

function row(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function cursor(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[1-9][0-9]{0,18}$/.test(value) &&
    (value.length < 19 || value <= '9223372036854775807')
  );
}

export function parseAdministrativeQuery(value: unknown): AdministrativeQuery | undefined {
  const input = row(value);
  if (!input || !validAccountId(input.organizationId)) return;
  const { organizationId, before } = input;
  const size = Object.keys(input).length;
  if (size === 1) return { organizationId: organizationId.toLowerCase() };
  if (size === 2 && cursor(before)) return { organizationId: organizationId.toLowerCase(), before };
}

function parseChange(value: unknown): AdministrativeChange | undefined {
  const item = row(value);
  if (!item) return;
  const { kind, grant, allMembers, revision, vaultId, vaultName } = item;
  const email = normalizeAccountEmail(item.email);
  if (
    kind === 'organization-created' ||
    kind === 'invitation-accepted' ||
    kind === 'invitation-declined' ||
    kind === 'member-left'
  )
    return { kind };
  if (
    kind === 'invitation-sent' ||
    kind === 'invitation-cancelled' ||
    kind === 'member-removed' ||
    kind === 'ownership-transferred'
  )
    return email ? { kind, email } : undefined;
  if (!validAccountId(vaultId) || !validDeviceLabel(vaultName)) return;
  const vault = { vaultId, vaultName };
  if (kind === 'vault-created') return { kind, ...vault };
  if (kind === 'vault-visibility' && typeof allMembers === 'boolean')
    return { kind, ...vault, allMembers };
  if (kind === 'vault-grant' && email && (grant === null || validVaultGrant(grant)))
    return { kind, ...vault, email, grant };
  if (kind === 'vault-published' && validSyncRevision(revision) && revision > 0)
    return { kind, ...vault, revision };
}

export function parseAdministrativePage(value: unknown): AdministrativePage | undefined {
  const view = row(value);
  if (
    !view ||
    !Array.isArray(view.events) ||
    view.events.length > ADMINISTRATIVE_EVENT_PAGE ||
    !(view.nextBefore === null || cursor(view.nextBefore))
  )
    return;
  const events: AdministrativeEvent[] = [];
  for (const source of view.events as unknown[]) {
    const item = row(source);
    if (!item) return;
    const { id, occurredAt } = item;
    const actorEmail = normalizeAccountEmail(item.actorEmail);
    const change = parseChange(item.change);
    if (
      !cursor(id) ||
      !actorEmail ||
      !change ||
      typeof occurredAt !== 'string' ||
      !Number.isFinite(Date.parse(occurredAt))
    )
      return;
    events.push({ id, actorEmail, occurredAt, change });
  }
  if (view.nextBefore !== null && view.nextBefore !== events.at(-1)?.id) return;
  return { events, nextBefore: view.nextBefore };
}
