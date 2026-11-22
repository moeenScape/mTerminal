ALTER TABLE account_devices ADD COLUMN retired_at timestamptz;

CREATE TABLE account_device_keys (
  account_id uuid NOT NULL,
  device_id uuid NOT NULL,
  identity_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  public_key text NOT NULL CHECK (char_length(public_key) BETWEEN 1 AND 3000),
  fingerprint text NOT NULL,
  PRIMARY KEY (account_id, device_id, identity_id),
  FOREIGN KEY (account_id, device_id) REFERENCES account_devices (account_id, id) ON DELETE CASCADE
);
