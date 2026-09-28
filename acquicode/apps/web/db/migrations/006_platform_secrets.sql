-- Deployment-level secrets created through the web setup: today, the GitHub App
-- created from a manifest (/setup). Not tenant data, so there is no org_id and no
-- tenant policy. Values are encrypted with DATA_ENCRYPTION_KEYS (AES-256-GCM, bound
-- to the row name), so a database dump alone does not reveal them. Environment
-- variables, when set, always take precedence over anything stored here.

CREATE TABLE platform_secrets (
  name       text PRIMARY KEY CHECK (name ~ '^[a-z][a-z0-9_]{0,63}$'),
  value_enc  text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
