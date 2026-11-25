ALTER TABLE accounts
  ADD COLUMN mfa_secret text,
  ADD COLUMN mfa_last_step bigint,
  ADD COLUMN mfa_recovery_hashes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN mfa_pending_secret text,
  ADD COLUMN mfa_pending_session_id uuid,
  ADD COLUMN mfa_pending_until timestamptz;

CREATE TABLE account_password_resets (
  email text PRIMARY KEY REFERENCES accounts(email) ON DELETE CASCADE,
  token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE account_attempt_limits (
  bucket text PRIMARY KEY,
  attempts integer NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE INDEX account_attempt_limits_expiry ON account_attempt_limits(expires_at);
