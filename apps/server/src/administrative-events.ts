import type { PoolClient } from 'pg';
import {
  ADMINISTRATIVE_EVENT_PAGE,
  type AdministrativeEvent,
  type AdministrativeChange,
  type AdministrativeQuery,
  type AdministrativePage,
} from '../../../packages/shared/administrative-events.ts';

export type AdministrativeActor = { id: string; email: string };

export async function recordAdministrativeEvent(
  client: PoolClient,
  organizationId: string,
  actor: AdministrativeActor,
  change: AdministrativeChange,
): Promise<void> {
  await client.query(
    `INSERT INTO organization_administrative_events (organization_id, actor_id, actor_email, change)
     VALUES ($1, $2, $3, $4)`,
    [organizationId, actor.id, actor.email, JSON.stringify(change)],
  );
}

export async function readAdministrativeEvents(
  client: PoolClient,
  { organizationId, before }: AdministrativeQuery,
): Promise<AdministrativePage> {
  const cursor = before ? ' AND id < $3::bigint' : '';
  const entries = await client.query<AdministrativeEvent>(
    `SELECT id::text, actor_email AS "actorEmail", occurred_at AS "occurredAt", change
     FROM organization_administrative_events
     WHERE organization_id = $1${cursor} ORDER BY organization_administrative_events.id DESC LIMIT $2`,
    before
      ? [organizationId, ADMINISTRATIVE_EVENT_PAGE + 1, before]
      : [organizationId, ADMINISTRATIVE_EVENT_PAGE + 1],
  );
  const events = entries.rows.slice(0, ADMINISTRATIVE_EVENT_PAGE);
  return {
    events,
    nextBefore: entries.rows.length > ADMINISTRATIVE_EVENT_PAGE ? events.at(-1)!.id : null,
  };
}
