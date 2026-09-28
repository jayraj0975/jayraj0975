-- Buyer-side requests: an acquirer asks a target for a dossier instead of their
-- code. Each request carries its own write-only token, so a delivered dossier is
-- attributable to the request and the token cannot be reused elsewhere.

CREATE TABLE dossier_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  target      text NOT NULL CHECK (length(target) BETWEEN 1 AND 120),
  note        text CHECK (note IS NULL OR length(note) <= 2000),
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'received', 'cancelled')),
  token_id    uuid REFERENCES api_tokens(id) ON DELETE SET NULL,
  scan_id     uuid REFERENCES scans(id) ON DELETE SET NULL,
  deliveries  integer NOT NULL DEFAULT 0,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz,
  expires_at  timestamptz NOT NULL
);
CREATE INDEX dossier_requests_org_idx ON dossier_requests(org_id, created_at DESC);

ALTER TABLE dossier_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE dossier_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON dossier_requests USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());

ALTER TABLE api_tokens ADD COLUMN request_id uuid REFERENCES dossier_requests(id) ON DELETE CASCADE;

-- The token lookup now also says which request (if any) a token belongs to.
DROP FUNCTION resolve_api_token(text);
CREATE FUNCTION resolve_api_token(p_token_hash text) RETURNS TABLE (org_id uuid, token_id uuid, scopes text[], request_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.org_id, t.id, t.scopes, t.request_id FROM api_tokens t
  WHERE t.token_hash = p_token_hash AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > now())
$$;
REVOKE EXECUTE ON FUNCTION resolve_api_token(text) FROM PUBLIC;
