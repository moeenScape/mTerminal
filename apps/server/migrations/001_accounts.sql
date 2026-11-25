CREATE TABLE accounts (
  id uuid PRIMARY KEY,
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE account_verifications (
  email text PRIMARY KEY,
  token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE account_devices (
  account_id uuid REFERENCES accounts(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  name text NOT NULL,
  last_signed_in_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, id)
);

CREATE TABLE account_sessions (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  device_id uuid NOT NULL,
  token_hash text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (account_id, device_id),
  FOREIGN KEY (account_id, device_id) REFERENCES account_devices(account_id, id) ON DELETE CASCADE
);
