import Link from 'next/link';
import { fmtDate, Notice, Readiness, TopBar } from '@/components/ui';
import { requirePageContext } from '@/lib/session';
import { rows, withOrg } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Repositories' };

interface RepoRow {
  id: string;
  provider: string;
  full_name: string;
  monitoring: boolean;
  installation_id: string | null;
  last_status: string | null;
  last_readiness: string | null;
  last_counts: { blocking: number; material: number; unknownsMaterial?: number } | null;
  last_finished: Date | null;
  last_scan: string | null;
  material_changes: number;
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requirePageContext();
  const params = await searchParams;
  const repos = await withOrg(ctx.org.id, (c) =>
    rows<RepoRow>(
      c,
      `SELECT r.id, r.provider, r.full_name, r.monitoring, r.installation_id::text,
              s.status AS last_status, ls.readiness AS last_readiness, ls.counts AS last_counts, ls.finished_at AS last_finished, s.id AS last_scan,
              (SELECT count(*)::int FROM change_events e WHERE e.repository_id = r.id AND e.severity = 'material' AND e.created_at > now() - interval '30 days') AS material_changes
       FROM repositories r
       LEFT JOIN LATERAL (SELECT id, status FROM scans WHERE repository_id = r.id ORDER BY created_at DESC LIMIT 1) s ON true
       LEFT JOIN LATERAL (SELECT readiness, counts, finished_at FROM scans WHERE repository_id = r.id AND status = 'succeeded' ORDER BY finished_at DESC LIMIT 1) ls ON true
       ORDER BY r.full_name`,
    ),
  );
  const tally = { READY: 0, REVIEW: 0, BLOCKED: 0, none: 0 };
  for (const r of repos) tally[(r.last_readiness as keyof typeof tally) ?? 'none']++;
  return (
    <>
      <TopBar signedIn current="app" />
      <main className="wrap" style={{ paddingTop: '1.5rem' }}>
        <div className="spread">
          <div>
            <div className="kicker">{ctx.org.name}</div>
            <h1 style={{ marginTop: '0.2rem' }}>Repositories</h1>
          </div>
          <div className="row">
            {ctx.orgs.length > 1 ? (
              <form action="/api/org/select" method="post" className="row">
                <label className="sr-only" htmlFor="org">Organisation</label>
                <select id="org" name="org" defaultValue={ctx.org.id}>
                  {ctx.orgs.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
                <button className="btn small" type="submit">Switch</button>
              </form>
            ) : null}
            <Link className="btn primary" href="/app/connect">Add source</Link>
          </div>
        </div>
        <Notice params={params} />
        {repos.length ? (
          <>
            <div className="counts">
              <div><span className="n">{tally.BLOCKED}</span><span className="l">blocked</span></div>
              <div><span className="n">{tally.REVIEW}</span><span className="l">review</span></div>
              <div><span className="n">{tally.READY}</span><span className="l">ready</span></div>
              <div><span className="n">{tally.none}</span><span className="l">not yet analysed</span></div>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Repository</th><th>Readiness</th><th>Why</th><th>Last snapshot</th><th>Continuous</th></tr>
                </thead>
                <tbody>
                  {repos.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link href={`/app/repos/${r.id}`}>{r.full_name}</Link>
                        <div className="faint small">{r.provider}{r.provider === 'github' && !r.installation_id ? ' · access removed' : ''}</div>
                      </td>
                      <td><Readiness level={r.last_readiness} />{r.last_status === 'queued' || r.last_status === 'running' ? <div className="small muted">{r.last_status}…</div> : null}{r.last_status === 'failed' ? <div className="small mat-material">last scan failed</div> : null}</td>
                      <td className="small">{r.last_counts ? `${r.last_counts.blocking} blocking · ${r.last_counts.material} material · ${r.last_counts.unknownsMaterial ?? 0} unknowns` : '—'}</td>
                      <td className="small">{r.last_scan && r.last_finished ? <Link href={`/app/scans/${r.last_scan}`}>{fmtDate(r.last_finished)}</Link> : '—'}{r.material_changes ? <div className="mat-material small">{r.material_changes} material change{r.material_changes === 1 ? '' : 's'} in 30 days</div> : null}</td>
                      <td className="small">{r.monitoring ? 'on' : r.provider === 'github' || r.provider === 'gitlab' ? 'off' : 'n/a'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="card" style={{ marginTop: '1.5rem' }}>
            <h2 style={{ marginTop: 0 }}>Start with one repository</h2>
            <p>Connect GitHub (read-only, you choose the repositories), add a GitLab project, upload a ZIP, or run the CLI where your code lives and push only the dossier.</p>
            <div className="row">
              <Link className="btn primary" href="/app/connect">Add source</Link>
              <Link className="btn" href="/sample">See what a dossier looks like</Link>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
