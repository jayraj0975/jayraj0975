import { fmtDate, Notice, TopBar } from '@/components/ui';
import { hasRole, requirePageContext } from '@/lib/session';
import { q, rows, withOrg } from '@/lib/db';
import { PLANS, planFor } from '@/lib/plans';
import { stripeConfigured } from '@/lib/config';
import { effectivePlan } from '@/lib/entitlements';
import { openReveal } from '@/lib/crypto';
import { EVENT_LABELS, NOTIFY_EVENTS } from '@/lib/notify';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Settings' };

export default async function Settings({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requirePageContext();
  const sp = await searchParams;
  const admin = hasRole(ctx, 'admin');
  const revealed = openReveal(sp.reveal, ctx.user.id);
  const newToken = revealed && /^acq_[A-Za-z0-9_-]+$/.test(revealed) ? revealed : null;
  const newSecret = revealed && /^whsec_[A-Za-z0-9_-]+$/.test(revealed) ? revealed : null;
  const members = await q<{ user_id: string; login: string; name: string | null; role: string; created_at: Date }>(
    'SELECT m.user_id, u.login, u.name, m.role, m.created_at FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = $1 ORDER BY m.created_at',
    [ctx.org.id],
  );
  const data = await withOrg(ctx.org.id, async (c) => ({
    invites: await rows<{ github_login: string; role: string }>(c, 'SELECT github_login, role FROM invitations ORDER BY created_at'),
    tokens: await rows<{ id: string; name: string; prefix: string; created_at: Date; expires_at: Date | null; last_used_at: Date | null; revoked_at: Date | null }>(c, 'SELECT id, name, prefix, created_at, expires_at, last_used_at, revoked_at FROM api_tokens WHERE request_id IS NULL ORDER BY created_at DESC LIMIT 50'),
    audit: await rows<{ id: string; action: string; actor_type: string; actor_id: string | null; target_type: string | null; target_id: string | null; created_at: Date; ip: string | null }>(c, 'SELECT id, action, actor_type, actor_id, target_type, target_id, created_at, ip FROM audit_events ORDER BY id DESC LIMIT 100'),
    plan: await effectivePlan(c, ctx.org.id),
    endpoints: await rows<{ id: string; url_hint: string; format: string; events: string[]; created_at: Date; last_attempt_at: Date | null; last_status: string | null; consecutive_failures: number }>(c, 'SELECT id, url_hint, format, events, created_at, last_attempt_at, last_status, consecutive_failures FROM notification_endpoints ORDER BY created_at'),
  }));
  const planRow = await q<{ plan: string; plan_expires_at: Date | null }>('SELECT plan, plan_expires_at FROM orgs WHERE id = $1', [ctx.org.id]);
  const stored = planRow[0];
  return (
    <>
      <TopBar signedIn current="settings" />
      <main className="wrap" style={{ paddingTop: '1.5rem' }}>
        <h1>Settings</h1>
        <Notice params={sp} />

        <section className="card" id="org">
          <h2 style={{ marginTop: 0 }}>Organisation</h2>
          <form action="/api/settings" method="post">
            <div className="grid2">
              <div className="field"><label htmlFor="name">Name</label><input id="name" name="name" type="text" defaultValue={ctx.org.name} disabled={!admin} maxLength={120} /></div>
              <div className="field">
                <label htmlFor="ret">Keep dossiers for (days)</label>
                <input id="ret" name="retention_days" type="number" min={7} max={3650} defaultValue={ctx.org.retentionDays} disabled={!admin} />
                <p className="hint">After this, dossier bodies are deleted; digests and readiness remain as your snapshot ledger.</p>
              </div>
            </div>
            <div className="field">
              <label><input type="checkbox" name="enrichment" defaultChecked={ctx.org.enrichmentEnabled} disabled={!admin} /> Check public dependencies against OSV.dev, npm and PyPI</label>
              <p className="hint">Sends public package names and versions only. Private packages are never sent. When off, vulnerability and some license sections are reported as unknown.</p>
            </div>
            {admin ? <button className="btn primary" type="submit">Save</button> : null}
          </form>
        </section>

        <section className="card" id="billing" style={{ marginTop: '1.25rem' }}>
          <h2 style={{ marginTop: 0 }}>Plan</h2>
          <p>Current plan: <strong>{data.plan.name}</strong>{stored?.plan_expires_at ? ` (until ${fmtDate(stored.plan_expires_at)})` : ''}{stored && planFor(stored.plan).id !== data.plan.id ? ' — previous plan expired' : ''}. Limits: {data.plan.limits.repositories} repositories, {data.plan.limits.hostedScansPerMonth} hosted scans per 30 days{data.plan.limits.shareLinks ? ', share links' : ''}{data.plan.limits.monitoring ? ', continuous mode' : ''}.</p>
          {stripeConfigured() ? (
            admin ? (
              <div className="grid3">
                {PLANS.filter((p) => p.checkout).map((p) => (
                  <form key={p.id} action="/api/billing/checkout" method="post" className="card plan">
                    <input type="hidden" name="plan" value={p.id} />
                    <h3>{p.name}</h3>
                    <div className="price">{p.price} <span className="small muted">{p.cadence}</span></div>
                    <ul className="small">{p.features.map((f) => <li key={f}>{f}</li>)}</ul>
                    <button className="btn" type="submit" disabled={p.id === data.plan.id}>{p.id === data.plan.id ? 'Current plan' : `Buy ${p.name}`}</button>
                  </form>
                ))}
              </div>
            ) : <p className="muted small">Admins can change the plan.</p>
          ) : (
            <p className="notice warn small">Billing is not configured on this deployment (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET). An operator can set an organisation&apos;s plan directly in the database; see RUNBOOK.md.</p>
          )}
        </section>

        <section className="card" id="members" style={{ marginTop: '1.25rem' }}>
          <h2 style={{ marginTop: 0 }}>Members</h2>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Person</th><th>Role</th><th>Since</th><th></th></tr></thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.user_id}>
                    <td>{m.name ?? m.login} <span className="faint small">@{m.login}</span></td>
                    <td>{m.role}</td>
                    <td className="small">{fmtDate(m.created_at)}</td>
                    <td>{admin && m.user_id !== ctx.user.id ? <form action={`/api/members/${m.user_id}/remove`} method="post"><button className="btn small danger" type="submit">Remove</button></form> : null}</td>
                  </tr>
                ))}
                {data.invites.map((i) => (
                  <tr key={i.github_login}><td>@{i.github_login} <span className="faint small">(invited, joins on first sign-in)</span></td><td>{i.role}</td><td></td><td></td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {admin ? (
            <form action="/api/members/invite" method="post" className="row" style={{ marginTop: '0.75rem' }}>
              <input name="login" type="text" placeholder="GitHub username" required aria-label="GitHub username" />
              <select name="role" defaultValue="member" aria-label="Role">
                <option value="viewer">Viewer (read dossiers)</option>
                <option value="member">Member (scan, declare)</option>
                {ctx.role === 'owner' ? <option value="admin">Admin (connect, share, delete)</option> : null}
              </select>
              <button className="btn" type="submit">Invite</button>
            </form>
          ) : null}
        </section>

        <section className="card" id="tokens" style={{ marginTop: '1.25rem' }}>
          <h2 style={{ marginTop: 0 }}>API tokens</h2>
          <p className="small">For <code>acquicode push</code> from CI or a laptop. Tokens can upload dossiers; they cannot read anything.</p>
          {newToken ? <div className="notice">New token (shown once, stored only as a hash): <code>{newToken}</code></div> : null}
          {data.tokens.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Name</th><th>Prefix</th><th>Created</th><th>Expires</th><th>Last used</th><th></th></tr></thead>
                <tbody>
                  {data.tokens.map((t) => (
                    <tr key={t.id}>
                      <td>{t.name}</td><td><code>{t.prefix}…</code></td><td className="small">{fmtDate(t.created_at)}</td><td className="small">{t.revoked_at ? 'revoked' : fmtDate(t.expires_at)}</td><td className="small">{fmtDate(t.last_used_at)}</td>
                      <td>{admin && !t.revoked_at ? <form action={`/api/tokens/${t.id}/revoke`} method="post"><button className="btn small danger" type="submit">Revoke</button></form> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="muted small">No tokens.</p>}
          {admin ? (
            <form action="/api/tokens/create" method="post" className="row" style={{ marginTop: '0.75rem' }}>
              <input name="name" type="text" placeholder="e.g. GitHub Actions" required maxLength={80} aria-label="Token name" />
              <select name="days" defaultValue="90" aria-label="Expiry"><option value="30">30 days</option><option value="90">90 days</option><option value="365">365 days</option></select>
              <button className="btn" type="submit">Create token</button>
            </form>
          ) : null}
        </section>

        <section className="card" id="notifications" style={{ marginTop: '1.25rem' }}>
          <h2 style={{ marginTop: 0 }}>Notifications</h2>
          <p className="small">
            Signed webhooks when a dossier is ready, an analysis fails, a snapshot changes materially, or a requested dossier arrives. Use a Slack incoming-webhook URL, or
            any https endpoint that accepts JSON. Payloads contain names, levels, counts and links, never code.
          </p>
          {newSecret ? (
            <div className="notice">
              Signing secret for the new endpoint (shown once): <code>{newSecret}</code>
              <div className="small muted">Each request carries <code>X-AcquiCode-Signature: t=&lt;unix&gt;,v1=&lt;HMAC-SHA256 of &quot;t.body&quot;&gt;</code>. Reject deliveries older than five minutes.</div>
            </div>
          ) : null}
          {data.endpoints.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Endpoint</th><th>Format</th><th>Events</th><th>Last delivery</th><th></th></tr></thead>
                <tbody>
                  {data.endpoints.map((e) => (
                    <tr key={e.id}>
                      <td><code>{e.url_hint}</code></td>
                      <td className="small">{e.format === 'slack' ? 'Slack' : 'JSON'}</td>
                      <td className="small">{e.events.map((x) => EVENT_LABELS[x as keyof typeof EVENT_LABELS] ?? x).join('; ')}</td>
                      <td className={`small${e.consecutive_failures ? ' status-attention' : ''}`}>{e.last_status ? `${e.last_status} · ${fmtDate(e.last_attempt_at)}` : 'none yet'}</td>
                      <td>
                        {admin ? (
                          <span className="row">
                            <form action={`/api/notifications/${e.id}/test`} method="post"><button className="btn small" type="submit">Send test</button></form>
                            <form action={`/api/notifications/${e.id}/delete`} method="post"><button className="btn small danger" type="submit">Remove</button></form>
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="muted small">No endpoints.</p>}
          {admin ? (
            data.plan.limits.monitoring ? (
              <form action="/api/notifications" method="post" style={{ marginTop: '0.75rem' }}>
                <div className="row">
                  <input name="url" type="url" required placeholder="https://hooks.slack.com/services/…" aria-label="Webhook URL" />
                  <select name="format" defaultValue="slack" aria-label="Format"><option value="slack">Slack</option><option value="json">JSON (signed)</option></select>
                </div>
                <fieldset className="checks">
                  <legend className="small muted">Events</legend>
                  {NOTIFY_EVENTS.map((ev) => (
                    <label key={ev} className="check"><input type="checkbox" name="events" value={ev} defaultChecked /> {EVENT_LABELS[ev]}</label>
                  ))}
                </fieldset>
                <button className="btn" type="submit">Add endpoint</button>
              </form>
            ) : <p className="small muted">Notifications are included in the Readiness, Custody and Acquirer plans.</p>
          ) : null}
        </section>

        <section className="card" id="audit" style={{ marginTop: '1.25rem' }}>
          <h2 style={{ marginTop: 0 }}>Audit log</h2>
          <p className="small muted">Append-only. The most recent 100 events.</p>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>When</th><th>Action</th><th>Actor</th><th>Target</th><th>IP</th></tr></thead>
              <tbody>
                {data.audit.map((a) => (
                  <tr key={a.id}><td className="small">{fmtDate(a.created_at)}</td><td className="small">{a.action}</td><td className="small">{a.actor_type}{a.actor_id ? ` ${a.actor_id.slice(0, 18)}` : ''}</td><td className="small">{a.target_type ? `${a.target_type} ${a.target_id?.slice(0, 18) ?? ''}` : ''}</td><td className="small">{a.ip ?? ''}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {ctx.role === 'owner' ? (
          <section className="card" id="delete" style={{ marginTop: '1.25rem' }}>
            <h2 style={{ marginTop: 0 }}>Delete organisation</h2>
            <p>Deletes every repository, dossier, declaration, share link, token and audit event of {ctx.org.name}. Immediate and irreversible.</p>
            <form action="/api/org/delete" method="post" className="row">
              <input name="confirm" type="text" placeholder={ctx.org.name} required autoComplete="off" aria-label="Type the organisation name" />
              <button className="btn danger" type="submit">Delete everything</button>
            </form>
          </section>
        ) : null}
      </main>
    </>
  );
}
