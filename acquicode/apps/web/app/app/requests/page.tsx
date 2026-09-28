import Link from 'next/link';
import { fmtDate, Notice, Readiness, TopBar } from '@/components/ui';
import { requirePageContext, hasRole } from '@/lib/session';
import { isUuid, rows, withOrg } from '@/lib/db';
import { openReveal } from '@/lib/crypto';
import { cliChecksum, site } from '@/lib/site';
import { CopyButton } from '@/components/CopyButton';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dossier requests' };

interface RequestRow {
  id: string;
  target: string;
  note: string | null;
  status: 'open' | 'received' | 'cancelled';
  created_at: Date;
  expires_at: Date;
  received_at: Date | null;
  deliveries: number;
  scan_id: string | null;
  readiness: string | null;
  attestation: string | null;
  signer_keyid: string | null;
}

function statusLabel(r: RequestRow): { text: string; cls: string } {
  if (r.status === 'cancelled') return { text: 'cancelled', cls: 'muted' };
  if (r.status === 'received') return { text: `received${r.deliveries > 1 ? ` ×${r.deliveries}` : ''}`, cls: 'status-satisfied' };
  if (new Date(r.expires_at).getTime() < Date.now()) return { text: 'expired', cls: 'muted' };
  return { text: 'waiting for the target', cls: 'status-attention' };
}

export default async function Requests({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requirePageContext();
  const sp = await searchParams;
  const s = site();
  const canCreate = hasRole(ctx, 'member');
  const requests = await withOrg(ctx.org.id, (c) =>
    rows<RequestRow>(
      c,
      `SELECT r.id, r.target, r.note, r.status, r.created_at, r.expires_at, r.received_at, r.deliveries, r.scan_id, s.readiness, s.attestation, s.signer_keyid
       FROM dossier_requests r LEFT JOIN scans s ON s.id = r.scan_id ORDER BY r.created_at DESC LIMIT 200`,
    ),
  );
  const createdId = typeof sp.created === 'string' && isUuid(sp.created) ? sp.created : null;
  const created = createdId ? requests.find((r) => r.id === createdId) ?? null : null;
  const revealed = openReveal(sp.reveal, ctx.user.id);
  const token = created && revealed && /^acq_[A-Za-z0-9_-]+$/.test(revealed) ? revealed : null;
  const cli = `${s.url}/cli/acquicode.mjs`;
  const sum = await cliChecksum();
  const instructions = token && created
    ? `${ctx.org.name} has asked for an AcquiCode dossier${created.note ? `:\n\n${created.note}` : '.'}

AcquiCode analyses your repository on your own machine or CI. Your source code is not sent to us or to ${ctx.org.name}; only the dossier (findings, file paths, hashes and metadata) is delivered. Needs Node.js 22+ and git.

1. Download the CLI and check it:
   curl -fsSL ${cli} -o acquicode.mjs
   ${sum ? `echo "${sum}  acquicode.mjs" | shasum -a 256 -c -` : `curl -fsSL ${cli}.sha256    # compare with: shasum -a 256 acquicode.mjs`}

2. Create a signing key (keep the private key; the public key is sent with the dossier):
   node acquicode.mjs keygen --out .acquicode-keys

3. In each repository to include, analyse and deliver:
   node acquicode.mjs scan . --osv --sign-key .acquicode-keys/acquicode-signing.key.pem
   node acquicode.mjs push acquicode-out/dossier.json \\
     --server ${s.url} --token ${token} \\
     --envelope acquicode-out/dossier.dsse.json --key .acquicode-keys/acquicode-signing.pub.pem

Open acquicode-out/dossier.html first if you want to read what will be delivered. This request expires on ${fmtDate(created.expires_at)}.`
    : null;

  return (
    <>
      <TopBar signedIn current="requests" />
      <main className="wrap" style={{ paddingTop: '1.5rem' }}>
        <div className="kicker">{ctx.org.name}</div>
        <h1 style={{ marginTop: '0.3rem' }}>Dossier requests</h1>
        <p className="muted" style={{ maxWidth: '46rem' }}>
          Ask a target company for a dossier instead of their code. Each request comes with a token that can only deliver dossiers to you, cannot read anything, and
          stops working when the request expires or you cancel it.
        </p>
        <Notice params={sp} />

        {instructions ? (
          <section className="card" style={{ borderColor: 'var(--accent)', margin: '1.25rem 0' }}>
            <h2 style={{ marginTop: 0 }}>Send this to {created!.target}</h2>
            <p className="small">
              The token below is shown <strong>once</strong> and stored only as a hash. Copy the whole message into an email to the target&apos;s CTO or deal lead.
            </p>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'end', marginBottom: '0.35rem' }}>
              <label htmlFor="brief" style={{ margin: 0 }}>Message for the target</label>
              <CopyButton target="brief" label="Copy message" />
            </div>
            <textarea id="brief" readOnly defaultValue={instructions} rows={instructions.split('\n').length + 2} style={{ minHeight: 0 }} />
          </section>
        ) : createdId ? (
          <div className="notice warn">The token for this request can no longer be shown. If it was not sent, cancel the request and create a new one.</div>
        ) : null}

        {canCreate ? (
          <section className="card" style={{ margin: '1.25rem 0' }}>
            <h2 style={{ marginTop: 0 }}>New request</h2>
            <form action="/api/requests" method="post">
              <div className="grid2">
                <div className="field">
                  <label htmlFor="target">Target company</label>
                  <input id="target" name="target" type="text" required maxLength={120} placeholder="e.g. Northwind Analytics" />
                </div>
                <div className="field">
                  <label htmlFor="days">Open for</label>
                  <select id="days" name="days" defaultValue="30">
                    <option value="7">7 days</option>
                    <option value="30">30 days</option>
                    <option value="90">90 days</option>
                  </select>
                </div>
              </div>
              <div className="field">
                <label htmlFor="note">Note to the target (optional)</label>
                <textarea id="note" name="note" maxLength={2000} style={{ minHeight: '5rem', fontFamily: 'var(--sans)' }} placeholder="Which repositories to include, and by when." />
              </div>
              <button className="btn primary" type="submit">Create request</button>
            </form>
          </section>
        ) : null}

        <h2>Requests</h2>
        {requests.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Target</th><th>Status</th><th>Latest dossier</th><th>Created</th><th>Expires</th><th></th></tr>
              </thead>
              <tbody>
                {requests.map((r) => {
                  const st = statusLabel(r);
                  return (
                    <tr key={r.id}>
                      <td><strong>{r.target}</strong>{r.note ? <div className="small muted">{r.note.length > 90 ? `${r.note.slice(0, 87)}…` : r.note}</div> : null}</td>
                      <td className={`small ${st.cls}`}>{st.text}</td>
                      <td className="small">
                        {r.scan_id ? (
                          <>
                            <Link href={`/app/scans/${r.scan_id}`}><Readiness level={r.readiness} /></Link>
                            <div className="muted">{r.attestation ? `signed · ${r.signer_keyid?.slice(0, 20)}…` : 'not signed'} · {fmtDate(r.received_at)}</div>
                          </>
                        ) : '—'}
                      </td>
                      <td className="small nowrap">{fmtDate(r.created_at)}</td>
                      <td className="small nowrap">{fmtDate(r.expires_at)}</td>
                      <td>
                        {r.status !== 'cancelled' && canCreate ? (
                          <form action={`/api/requests/${r.id}/cancel`} method="post"><button className="btn small danger" type="submit">Cancel</button></form>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No requests yet. Create one above, then send the message it produces to the target.</p>
        )}
      </main>
    </>
  );
}
