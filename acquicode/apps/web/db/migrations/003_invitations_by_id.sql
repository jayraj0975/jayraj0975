-- Invitations bind to GitHub's immutable numeric user id, not the login.
-- A login can be renamed and then registered by someone else; an invitation
-- keyed on it would let that person join the organisation.

ALTER TABLE invitations ADD COLUMN github_id bigint;
-- Login-only invitations cannot be claimed safely. Admins re-invite.
DELETE FROM invitations WHERE github_id IS NULL;
ALTER TABLE invitations ALTER COLUMN github_id SET NOT NULL;
ALTER TABLE invitations DROP CONSTRAINT invitations_org_id_github_login_key;
ALTER TABLE invitations ADD CONSTRAINT invitations_org_id_github_id_key UNIQUE (org_id, github_id);

DROP FUNCTION claim_invitations(text, uuid);
CREATE FUNCTION claim_invitations(p_github_id bigint, p_user uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  INSERT INTO memberships (org_id, user_id, role)
    SELECT org_id, p_user, role FROM invitations WHERE github_id = p_github_id
    ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM invitations WHERE github_id = p_github_id;
  RETURN n;
END $$;

-- Definer functions are callable only by the roles migrate.ts grants explicitly.
REVOKE EXECUTE ON FUNCTION resolve_share_link(text), resolve_api_token(text), resolve_installation(bigint), resolve_repository(uuid), monitored_repositories(), claim_invitations(bigint, uuid) FROM PUBLIC;
