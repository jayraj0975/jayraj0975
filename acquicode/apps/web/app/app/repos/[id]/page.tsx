import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fmtDate, Notice, Readiness, TopBar } from '@/components/ui';
import { requirePageContext, hasRole } from '@/lib/session';
import { isUuid, row, rows, withOrg } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Repository' };

const TEMPLATE = `# Company declarations. Everything here is shown as company-asserted and checked against evidence.
company:
  names: ["Example Co, Inc."]
  domains: ["example.com"]
distribution: saas          # saas | distributed | on_prem | mobile | library | internal | mixed
ai_usage: some              # none | some
ai_tools:
  - tool: claude-code
    plan: enterprise
    indemnity: true
    from: 2025-01-01
    evidence: "Commercial agreement dated 2024-12-15"
origins:
  - paths: ["src/core/**"]
    origin: human           # human | ai_assisted | ai_generated | third_party | generated
    statement: "Core engine written by the founding team"
    declared_on: 2025-06-01
    by: "CTO"
contributors:
  - email: jane@example.com
    agreement: employee_piia  # employee_piia | contractor_assignment | founder_assignment | cla | none | unknown
    signed_on: 2024-01-10
`;

export default async function Repo({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requirePageContext();
  const sp = await searchParams;
  const tab = sp.tab === 'declarations' ? 'declarations' : sp.tab === 'danger' ? 'danger' : 'timeline';
  const data = await withOrg(ctx.org.id, async (c) => {
    const repo = await row<{ id: string; provider: string; full_name: string; monitoring: boolean; installation_id: string | null; default_branch: string | null; created_at: Date }>(c, 'SELECT id, provider, full_name, monitoring, installation_id::text, default_branch, created_at FROM repositories WHERE id = $1', [id]);
    if (!repo) return null;
    const scans = await rows<{ id: string; status: string; trigger: string; readiness: string | null; counts: { blocking: number; material: number } | null; commit_sha: string | null; attestation: string | null; created_at: Date; finished_at: Date | null; error: string | null; digest: string | null }>(
      c,
      'SELECT id, status, trigger, readiness, counts, commit_sha, attestation, created_at, finished_at, error, digest FROM scans WHERE repository_id = $1 ORDER BY created_at DESC LIMIT 50',
      [id],
    );
    const events = await rows<{ id: string; scan_id: string; kind: string; severity: string; summary: string; created_at: Date }>(c, 'SELECT id, scan_id, kind, severity, summary, created_at FROM change_events WHERE repository_id = $1 ORDER BY created_at DESC, id LIMIT 200', [id]);
    const decls = await rows<{ id: string; content: string; created_at: Date; digest: string }>(c, 'SELECT id, content, created_at, digest FROM declarations WHERE repository_id = $1 ORDER BY created_at DESC LIMIT 20', [id]);
    return { repo, scans, events, decls };
  });
  if (!data) notFound();
  const { repo, scans, events, decls } = data;
  const latest = scans.find((s) => s.status === 'succeeded');
  const canScan = hasRole(ctx, 'member') && (repo.provider === 'github' ? !!repo.installation_id : repo.provider === 'gitlab');
  return (
    <>
      <TopBar signedIn current="app" />
      <main className="wrap" style={{ paddingTop: '1.5rem' }}>
        <p className="small"><Link href="/app">← Repositories</Link></p>
        <div className="spread">
          <div>
            <div className="kicker">{repo.provider}{repo.default_branch ? ` · ${repo.default_branch}` : ''}</div>
            <h1 style={{ marginTop: '0.2rem' }}>{repo.full_name}</h1>
            <div className="row"><Readiness level={latest?.readiness} />{latest ? <Link className="small" href={`/app/scans/${latest.id}`}>Open latest dossier</Link> : null}</div>
          </div>
          <div className="row">
            {canScan ? (
              <form action={`/api/repos/${repo.id}/scan`} method="post"><button className="btn primary" type="submit">Scan now</button></form>
            ) : null}
            {repo.provider === 'upload' && hasRole(ctx, 'member') ? (
              <form action="/api/uploads" method="post" encType="multipart/form-data" className="row">
                <input type="hidden" name="repositoryId" value={repo.id} />
                <input type="file" name="archive" accept=".zip" required aria-label="New archive" />
                <button className="btn primary" type="submit">Upload new version</button>
              </form>
            ) : null}
            {(repo.provider === 'github' || repo.provider === 'gitlab') && hasRole(ctx, 'admin') ? (
              <form action={`/api/repos/${repo.id}/monitoring`} method="post">
                <input type="hidden" name="enable" value={repo.monitoring ? '0' : '1'} />
                <button className="btn" type="submit">{repo.monitoring ? 'Turn off continuous mode' : 'Turn on continuous mode'}</button>
              </form>
            ) : null}
          </div>
        </div>
        <Notice params={sp} />
        {repo.provider === 'github' && !repo.installation_id ? <div className="notice warn">The GitHub App no longer has access to this repository. Reinstall it from Add source to scan again; existing dossiers remain available.</div> : null}
        {repo.provider === 'cli' ? <div className="notice">This repository is analysed where the code lives. Push new dossiers with <code>acquicode push</code>.</div> : null}

        <nav className="tabs" aria-label="Repository sections">
          <Link href={`/app/repos/${repo.id}`} aria-current={tab === 'timeline' ? 'page' : undefined}>Snapshots &amp; changes</Link>
          <Link href={`/app/repos/${repo.id}?tab=declarations`} aria-current={tab === 'declarations' ? 'page' : undefined}>Declarations &amp; IP register</Link>
          {hasRole(ctx, 'admin') ? <Link href={`/app/repos/${repo.id}?tab=danger`} aria-current={tab === 'danger' ? 'page' : undefined}>Delete</Link> : null}
        </nav>

        {tab === 'timeline' ? (
          <div className="grid2">
            <section>
              <h2 style={{ marginTop: 0 }}>Snapshots</h2>
              {scans.length ? (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>When</th><th>Result</th><th>Commit</th><th>How</th></tr></thead>
                    <tbody>
                      {scans.map((s) => (
                        <tr key={s.id}>
                          <td className="small"><Link href={`/app/scans/${s.id}`}>{fmtDate(s.finished_at ?? s.created_at)}</Link></td>
                          <td>{s.status === 'succeeded' ? <Readiness level={s.readiness} /> : <span className={s.status === 'failed' ? 'mat-material small' : 'small muted'}>{s.status}</span>}{s.error ? <div className="small muted">{s.error.slice(0, 140)}</div> : null}</td>
                          <td className="small"><code>{s.commit_sha?.slice(0, 10) ?? '—'}</code></td>
                          <td className="small">{s.trigger}{s.attestation ? <div className="faint">{s.attestation === 'PLATFORM_ATTESTED' ? 'platform-signed' : 'self-signed'}</div> : null}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="muted">No snapshots yet.</p>}
            </section>
            <section>
              <h2 style={{ marginTop: 0 }}>What changed</h2>
              <p className="small muted">Each snapshot is compared with the previous one. Only changes that could affect a buyer are listed as material.</p>
              {events.length ? (
                <ul className="evidence-list">
                  {events.map((e) => (
                    <li key={e.id}>
                      <span className={`pill mat-${e.severity}`}>{e.severity}</span> {e.summary}{' '}
                      <Link className="faint small" href={`/app/scans/${e.scan_id}`}>{fmtDate(e.created_at)}</Link>
                    </li>
                  ))}
                </ul>
              ) : <p className="muted">Changes appear after the second snapshot.</p>}
            </section>
          </div>
        ) : null}

        {tab === 'declarations' ? (
          <div className="grid2">
            <section>
              <h2 style={{ marginTop: 0 }}>Declarations</h2>
              <p className="small">Statements the company makes about itself: distribution model, AI tools and their terms, origin of code areas, and the IP register. They are shown as <strong>company-asserted</strong> and checked against the evidence; contradictions are reported. Each save is a new version.</p>
              {hasRole(ctx, 'member') ? (
                <form action={`/api/repos/${repo.id}/declarations`} method="post">
                  <label htmlFor="decl">acquicode.yml</label>
                  <textarea id="decl" name="content" defaultValue={decls[0]?.content ?? TEMPLATE} spellCheck={false} />
                  <p className="hint">Declarations saved here take precedence over an acquicode.yml committed to the repository.</p>
                  <button className="btn primary" type="submit">Save new version</button>
                </form>
              ) : <pre>{decls[0]?.content ?? 'No declarations yet.'}</pre>}
            </section>
            <section>
              <h2 style={{ marginTop: 0 }}>IP register</h2>
              <p className="small">Upload a CSV with columns <code>email,name,agreement,signed_on,entity</code>. It replaces the <code>contributors</code> section in a new declarations version. Agreements: employee_piia, contractor_assignment, founder_assignment, cla, none, unknown.</p>
              {hasRole(ctx, 'member') ? (
                <form action={`/api/repos/${repo.id}/register`} method="post" encType="multipart/form-data" className="row">
                  <input type="file" name="register" accept=".csv,text/csv" required aria-label="Register CSV" />
                  <button className="btn" type="submit">Import register</button>
                </form>
              ) : null}
              <h3>History</h3>
              {decls.length ? (
                <ul className="small">{decls.map((d) => <li key={d.id}>{fmtDate(d.created_at)} · <code>{d.digest.slice(0, 12)}</code></li>)}</ul>
              ) : <p className="muted small">No versions yet.</p>}
            </section>
          </div>
        ) : null}

        {tab === 'danger' && hasRole(ctx, 'admin') ? (
          <section className="card">
            <h2 style={{ marginTop: 0 }}>Delete this repository</h2>
            <p>Deletes every snapshot, encrypted dossier, declaration version, change record and share link for {repo.full_name}. This cannot be undone. Audit events are kept.</p>
            <form action={`/api/repos/${repo.id}/delete`} method="post" className="row">
              <label className="sr-only" htmlFor="confirm">Type the repository name</label>
              <input id="confirm" name="confirm" type="text" placeholder={repo.full_name} required autoComplete="off" />
              <button className="btn danger" type="submit">Delete permanently</button>
            </form>
          </section>
        ) : null}
      </main>
    </>
  );
}
