CREATE TABLE organizations (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  owner_account_id uuid NOT NULL
);

CREATE TABLE organization_members (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  PRIMARY KEY (organization_id, account_id)
);

-- Ownership is always held by a member, including after transfers.
ALTER TABLE organizations ADD CONSTRAINT organization_owner_membership
  FOREIGN KEY (id, owner_account_id) REFERENCES organization_members (organization_id, account_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX organization_members_by_account ON organization_members (account_id, organization_id);

CREATE TABLE organization_invitations (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  expires_at timestamptz NOT NULL,
  UNIQUE (organization_id, email)
);

CREATE INDEX organization_invitations_by_email ON organization_invitations (email, expires_at);
