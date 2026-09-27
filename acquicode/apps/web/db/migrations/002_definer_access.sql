-- SECURITY DEFINER lookups run as the table owner. Tenant tables FORCE row-level
-- security, which binds the owner too unless it is a superuser, and managed
-- PostgreSQL services (RDS, Cloud SQL, Azure) never hand out superuser. Without
-- these policies every pre-authentication lookup (share links, API tokens,
-- GitHub and GitLab webhooks, invitations) silently returns nothing there.
--
-- The policies apply only to the role that owns the schema (the migration
-- role). scripts/migrate.ts refuses to run if the application role is, or is a
-- member of, that role, or can bypass row-level security.

DO $$
DECLARE owner text := current_user;
BEGIN
  EXECUTE format('CREATE POLICY definer_lookup ON share_links FOR SELECT TO %I USING (true)', owner);
  EXECUTE format('CREATE POLICY definer_lookup ON api_tokens FOR SELECT TO %I USING (true)', owner);
  EXECUTE format('CREATE POLICY definer_lookup ON github_installations FOR SELECT TO %I USING (true)', owner);
  EXECUTE format('CREATE POLICY definer_lookup ON repositories FOR SELECT TO %I USING (true)', owner);
  EXECUTE format('CREATE POLICY definer_lookup ON invitations FOR ALL TO %I USING (true) WITH CHECK (true)', owner);
END $$;

-- The daily scheduler runs before any organisation is known. It gets ids only.
CREATE OR REPLACE FUNCTION monitored_repositories() RETURNS TABLE (repository_id uuid, org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, org_id FROM repositories WHERE monitoring AND provider IN ('github', 'gitlab')
$$;
