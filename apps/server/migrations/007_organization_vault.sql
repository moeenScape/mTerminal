CREATE TABLE organization_vaults (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision BETWEEN 1 AND 2147483647),
  write_hash text NOT NULL CHECK (length(write_hash) = 64),
  envelope jsonb NOT NULL CHECK (octet_length(envelope::text) <= 1399126)
);
