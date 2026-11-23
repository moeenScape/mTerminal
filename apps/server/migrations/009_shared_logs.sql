CREATE TABLE organization_shared_logs (
  organization_id uuid NOT NULL,
  vault_id uuid NOT NULL,
  id uuid NOT NULL,
  shared_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '720 hours'),
  label jsonb NOT NULL CHECK (octet_length(label::text) <= 1280),
  transcript jsonb NOT NULL CHECK (octet_length(transcript::text) <= 270592),
  PRIMARY KEY (organization_id, vault_id, id),
  FOREIGN KEY (organization_id, vault_id) REFERENCES organization_vault_catalog (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX shared_logs_expiry ON organization_shared_logs (expires_at);

CREATE TABLE organization_log_annotations (
  organization_id uuid NOT NULL,
  vault_id uuid NOT NULL,
  log_id uuid NOT NULL,
  id uuid NOT NULL,
  author_email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  envelope jsonb NOT NULL CHECK (octet_length(envelope::text) <= 4352),
  PRIMARY KEY (organization_id, vault_id, log_id, id),
  FOREIGN KEY (organization_id, vault_id, log_id) REFERENCES organization_shared_logs (organization_id, vault_id, id) ON DELETE CASCADE
);
