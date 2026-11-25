CREATE TABLE organization_administrative_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL,
  actor_email text NOT NULL CHECK (char_length(actor_email) BETWEEN 1 AND 254),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  change jsonb NOT NULL CHECK (jsonb_typeof(change) = 'object' AND octet_length(change::text) <= 2048)
);

CREATE INDEX organization_administrative_events_page
  ON organization_administrative_events (organization_id, id DESC);
