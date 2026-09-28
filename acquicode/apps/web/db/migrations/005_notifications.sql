-- Outbound notifications: signed webhooks (generic JSON or Slack-compatible)
-- for scan results, material changes between snapshots and fulfilled requests.

CREATE TABLE notification_endpoints (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  -- Webhook URLs are secrets (a Slack URL lets anyone post to the channel): stored encrypted,
  -- with a masked hint for display.
  url_enc         text NOT NULL,
  url_hint        text NOT NULL,
  format          text NOT NULL CHECK (format IN ('json', 'slack')),
  secret_enc      text NOT NULL,
  events          text[] NOT NULL,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  last_status     text,
  consecutive_failures integer NOT NULL DEFAULT 0
);
CREATE INDEX notification_endpoints_org_idx ON notification_endpoints(org_id);

ALTER TABLE notification_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_endpoints FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notification_endpoints USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());
