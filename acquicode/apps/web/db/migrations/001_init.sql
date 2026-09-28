-- AcquiCode schema v1.
-- Tenant isolation: every organisation-scoped table has org_id and a row-level
-- security policy keyed on the per-transaction setting app.org_id. Policies are
-- FORCED so they also apply to the table owner. The application connects as a
-- role without BYPASSRLS; only the migration role may bypass.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION current_org_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.org_id', true), '')::uuid
$$;

-- ---------------------------------------------------------------- global tables (not tenant-scoped)

CREATE TABLE users (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  github_id    bigint UNIQUE,
  login        text NOT NULL,
  name         text,
  email        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE TABLE sessions (
  id_hash      text PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ip           text,
  user_agent   text
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE orgs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  plan            text NOT NULL DEFAULT 'free',
  plan_expires_at timestamptz,
  credits_dossiers integer NOT NULL DEFAULT 0,
  retention_days  integer NOT NULL DEFAULT 365 CHECK (retention_days BETWEEN 7 AND 3650),
  enrichment_enabled boolean NOT NULL DEFAULT true,
  stripe_customer_id text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  org_id     uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships(user_id);

-- Invitations by GitHub login, accepted on that user's next sign-in.
CREATE TABLE invitations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  github_login text NOT NULL,
  role         text NOT NULL CHECK (role IN ('admin', 'member', 'viewer')),
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, github_login)
);

-- Background jobs are picked up across organisations by the worker.
CREATE TABLE jobs (
  id          bigserial PRIMARY KEY,
  org_id      uuid REFERENCES orgs(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}',
  status      text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  attempts    integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  run_after   timestamptz NOT NULL DEFAULT now(),
  locked_at   timestamptz,
  locked_by   text,
  last_error  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX jobs_pick_idx ON jobs(status, run_after) WHERE status = 'queued';

CREATE TABLE rate_limits (
  key          text NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer NOT NULL,
  PRIMARY KEY (key, window_start)
);

CREATE TABLE webhook_deliveries (
  source      text NOT NULL,
  delivery_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, delivery_id)
);

-- GitHub App installations map to exactly one organisation.
CREATE TABLE github_installations (
  installation_id bigint PRIMARY KEY,
  org_id          uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  account_login   text NOT NULL,
  account_type    text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  suspended_at    timestamptz
);

-- ---------------------------------------------------------------- tenant tables

CREATE TABLE repositories (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  provider        text NOT NULL CHECK (provider IN ('github', 'gitlab', 'upload', 'cli')),
  external_id     text,
  full_name       text NOT NULL,
  default_branch  text,
  clone_url       text,
  installation_id bigint,
  credential_enc  text,
  webhook_secret_hash text,
  monitoring      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, provider, full_name)
);

CREATE TABLE scans (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  repository_id uuid NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  trigger       text NOT NULL CHECK (trigger IN ('manual', 'push', 'schedule', 'upload', 'cli')),
  ref           text,
  commit_sha    text,
  readiness     text CHECK (readiness IN ('READY', 'REVIEW', 'BLOCKED')),
  counts        jsonb,
  digest        text,
  attestation   text CHECK (attestation IN ('SELF_ATTESTED', 'PLATFORM_ATTESTED')),
  signer_keyid  text,
  error         text,
  upload_key    text,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  finished_at   timestamptz
);
CREATE INDEX scans_repo_idx ON scans(repository_id, created_at DESC);

-- Dossier bodies live in object storage, encrypted; this row points at them.
CREATE TABLE dossiers (
  scan_id     uuid PRIMARY KEY REFERENCES scans(id) ON DELETE CASCADE,
  org_id      uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  storage_key text NOT NULL,
  envelope    jsonb,
  digest      text NOT NULL,
  size_bytes  integer NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE change_events (
  id               bigserial PRIMARY KEY,
  org_id           uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  repository_id    uuid NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  scan_id          uuid NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  previous_scan_id uuid REFERENCES scans(id) ON DELETE SET NULL,
  kind             text NOT NULL,
  severity         text NOT NULL CHECK (severity IN ('material', 'minor', 'info')),
  summary          text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX change_events_repo_idx ON change_events(repository_id, created_at DESC);

-- Declarations are versioned and never overwritten.
CREATE TABLE declarations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  repository_id uuid NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  content       text NOT NULL,
  digest        text NOT NULL,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX declarations_repo_idx ON declarations(repository_id, created_at DESC);

CREATE TABLE share_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  scan_id     uuid NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  label       text NOT NULL,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  views       integer NOT NULL DEFAULT 0,
  last_viewed_at timestamptz,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE api_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name        text NOT NULL,
  token_hash  text NOT NULL UNIQUE,
  prefix      text NOT NULL,
  scopes      text[] NOT NULL DEFAULT ARRAY['dossiers:write'],
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz,
  last_used_at timestamptz,
  revoked_at  timestamptz
);

-- Append-only audit trail.
CREATE TABLE audit_events (
  id          bigserial PRIMARY KEY,
  org_id      uuid REFERENCES orgs(id) ON DELETE CASCADE,
  actor_type  text NOT NULL CHECK (actor_type IN ('user', 'token', 'share_link', 'system', 'webhook')),
  actor_id    text,
  action      text NOT NULL,
  target_type text,
  target_id   text,
  ip          text,
  meta        jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_org_idx ON audit_events(org_id, created_at DESC);

CREATE OR REPLACE FUNCTION audit_events_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END $$;
CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events FOR EACH ROW EXECUTE FUNCTION audit_events_immutable();

-- ---------------------------------------------------------------- row-level security

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['repositories', 'scans', 'dossiers', 'change_events', 'declarations', 'share_links', 'api_tokens', 'invitations', 'github_installations']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id())', t);
  END LOOP;
END $$;

-- Audit rows may be written for the current org; reads are scoped the same way.
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_events USING (org_id = current_org_id()) WITH CHECK (org_id IS NULL OR org_id = current_org_id());

-- Lookups that must happen before the org is known (share links, API tokens,
-- installation webhooks, GitLab webhooks) go through narrow SECURITY DEFINER
-- functions that return only the org id, never tenant data.
CREATE OR REPLACE FUNCTION resolve_share_link(p_token_hash text) RETURNS TABLE (org_id uuid, link_id uuid, scan_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.org_id, s.id, s.scan_id FROM share_links s
  WHERE s.token_hash = p_token_hash AND s.revoked_at IS NULL AND s.expires_at > now()
$$;

CREATE OR REPLACE FUNCTION resolve_api_token(p_token_hash text) RETURNS TABLE (org_id uuid, token_id uuid, scopes text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.org_id, t.id, t.scopes FROM api_tokens t
  WHERE t.token_hash = p_token_hash AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > now())
$$;

CREATE OR REPLACE FUNCTION resolve_installation(p_installation_id bigint) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT org_id FROM github_installations WHERE installation_id = p_installation_id
$$;

CREATE OR REPLACE FUNCTION resolve_repository(p_repository_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT org_id FROM repositories WHERE id = p_repository_id
$$;

CREATE OR REPLACE FUNCTION claim_invitations(p_login text, p_user uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  INSERT INTO memberships (org_id, user_id, role)
    SELECT org_id, p_user, role FROM invitations WHERE lower(github_login) = lower(p_login)
    ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM invitations WHERE lower(github_login) = lower(p_login);
  RETURN n;
END $$;
