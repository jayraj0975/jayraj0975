import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DossierView, parseView } from '@/components/DossierView';
import { fmtDate, Notice, TopBar } from '@/components/ui';
import { hasRole, requirePageContext } from '@/lib/session';
import { isUuid, row, rows, withOrg } from '@/lib/db';
import { loadDossier } from '@/lib/dossiers';
import { config } from '@/lib/config';
import { openReveal } from '@/lib/crypto';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dossier' };

export default async function ScanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requirePageContext();
  const sp = await searchParams;
  const data = await withOrg(ctx.org.id, async (c) => {
    const scan = await row<{ id: string; status: string; trigger: string; error: string | null; created_at: Date; finished_at: Date | null; repository_id: string; full_name: string; attestation: string | null; signer_keyid: string | null; digest: string | null }>(
      c,
      'SELECT s.id, s.status, s.trigger, s.error, s.created_at, s.finished_at, s.repository_id, r.full_name, s.attestation, s.signer_keyid, s.digest FROM scans s JOIN repositories r ON r.id = s.repository_id WHERE s.id = $1',
      [id],
    );
    if (!scan) return null;
    const links = await rows<{ id: string; label: string; expires_at: Date; revoked_at: Date | null; views: number; last_viewed_at: Date | null }>(c, 'SELECT id, label, expires_at, revoked_at, views, last_viewed_at FROM share_links WHERE scan_id = $1 ORDER BY created_at DESC', [id]);
    return { scan, links };
  });
  if (!data) notFound();
  const { scan, links } = data;
  const loaded = scan.status === 'succeeded' ? await loadDossier(ctx.org.id, id) : null;
  const revealed = openReveal(sp.reveal, ctx.user.id);
  const shareToken = revealed && /^shr_[A-Za-z0-9_-]+$/.test(revealed) ? revealed : null;
  const pending = scan.status === 'queued' || scan.status === 'running';

  const extra = loaded ? (
    <div className="grid2" style={{ marginTop: '1rem' }}>
      <div className="card">
        <h3>Attestation</h3>
        <dl className="kv">
          <dt>Digest</dt><dd><code>{loaded.digest}</code></dd>
          <dt>Signed</dt><dd>{scan.attestation ? `${scan.attestation === 'PLATFORM_ATTESTED' ? 'Platform-attested (analysed by the hosted runner)' : 'Self-attested (analysed where the code lives)'} · ${scan.signer_keyid}` : 'Not signed (no signing key configured when produced)'}</dd>
          <dt>Produced</dt><dd>{fmtDate(scan.finished_at)} · {scan.trigger}</dd>
        </dl>
      </div>
      <div className="card">
        <h3>Share with a buyer or counsel</h3>
        {shareToken ? (
          <div className="notice">
            Copy this link now; it is shown once and stored only as a hash:
            <div><code>{new URL(`/s/${shareToken}`, config().APP_URL).toString()}</code></div>
          </div>
        ) : null}
        {hasRole(ctx, 'admin') ? (
          <form action={`/api/scans/${id}/share`} method="post" className="row">
            <input name="label" type="text" placeholder="e.g. Acme Corp counsel" aria-label="Label" maxLength={120} />
            <select name="days" defaultValue="30" aria-label="Expires after">
              <option value="7">7 days</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
            </select>
            <button className="btn" type="submit">Create read-only link</button>
          </form>
        ) : <p className="small muted">Admins can create share links.</p>}
        {links.length ? (
          <ul className="evidence-list" style={{ marginTop: '0.75rem' }}>
            {links.map((l) => (
              <li key={l.id} className="spread">
                <span>{l.label} · {l.revoked_at ? 'revoked' : `expires ${fmtDate(l.expires_at)}`} · {l.views} view{l.views === 1 ? '' : 's'}{l.last_viewed_at ? `, last ${fmtDate(l.last_viewed_at)}` : ''}</span>
                {!l.revoked_at && hasRole(ctx, 'admin') ? (
                  <form action={`/api/share/${l.id}/revoke`} method="post"><button className="btn small danger" type="submit">Revoke</button></form>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  ) : null;

  return (
    <>
      {pending ? <meta httpEquiv="refresh" content="5" /> : null}
      <TopBar signedIn current="app" />
      <main className="wrap" style={{ paddingTop: '1.5rem' }}>
        <p className="small"><Link href={`/app/repos/${scan.repository_id}`}>← {scan.full_name}</Link></p>
        <h1 style={{ marginTop: '0.2rem' }}>{loaded?.dossier.title ?? scan.full_name}</h1>
        <Notice params={sp} />
        {pending ? (
          <div className="card">
            <h2 style={{ marginTop: 0 }}>{scan.status === 'queued' ? 'Waiting for a worker…' : 'Analysing…'}</h2>
            <p className="muted">Cloning with a short-lived read-only token, reading history, dependencies and licenses, then signing the dossier. This page refreshes every few seconds.</p>
          </div>
        ) : null}
        {scan.status === 'failed' ? (
          <div className="notice error">
            <strong>The scan failed.</strong> {scan.error ?? 'No details were recorded.'} Nothing partial was published. {hasRole(ctx, 'member') ? 'Fix the cause and scan again from the repository page.' : ''}
          </div>
        ) : null}
        {scan.status === 'succeeded' && !loaded ? <div className="notice warn">This dossier&apos;s body was removed by the retention policy. The digest remains in the snapshot ledger: <code>{scan.digest}</code></div> : null}
        {loaded ? <DossierView d={loaded.dossier} view={parseView(sp.view)} base={`/app/scans/${id}`} downloads={`/api/scans/${id}/download`} extra={extra} /> : null}
      </main>
    </>
  );
}
