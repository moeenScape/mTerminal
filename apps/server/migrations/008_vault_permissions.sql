CREATE TABLE organization_vault_catalog (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  all_members boolean NOT NULL DEFAULT false,
  UNIQUE (organization_id, id)
);

CREATE UNIQUE INDEX organization_vault_catalog_name
  ON organization_vault_catalog (organization_id, lower(name));

INSERT INTO organization_vault_catalog (id, organization_id, name, all_members)
SELECT id, id, 'Shared vault', true FROM organizations;

-- Keep the default vault's identity so its existing ciphertext and key remain valid.
ALTER TABLE organization_vaults ADD COLUMN vault_id uuid;
UPDATE organization_vaults SET vault_id = organization_id;
ALTER TABLE organization_vaults DROP CONSTRAINT organization_vaults_pkey;
ALTER TABLE organization_vaults ADD PRIMARY KEY (organization_id, vault_id);
ALTER TABLE organization_vaults ADD FOREIGN KEY (organization_id, vault_id)
  REFERENCES organization_vault_catalog (organization_id, id) ON DELETE CASCADE;

CREATE TABLE organization_vault_grants (
  organization_id uuid NOT NULL,
  vault_id uuid NOT NULL,
  account_id uuid NOT NULL,
  access text NOT NULL CHECK (access IN ('reader', 'editor')),
  PRIMARY KEY (organization_id, vault_id, account_id),
  FOREIGN KEY (organization_id, vault_id)
    REFERENCES organization_vault_catalog (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, account_id)
    REFERENCES organization_members (organization_id, account_id) ON DELETE CASCADE
);

CREATE INDEX organization_vault_grants_member ON organization_vault_grants (organization_id, account_id);
