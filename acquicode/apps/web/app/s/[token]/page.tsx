import { DossierView, parseView } from '@/components/DossierView';
import { fmtDate, Footer } from '@/components/ui';
import { resolveShare } from '@/lib/share';
import { headers } from 'next/headers';
import { ipFromHeaders } from '@/lib/http';
import { platformKey } from '@/lib/signing';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Shared dossier', robots: { index: false, follow: false } };

/** Read-only view for a buyer or counsel. No account needed; every view is recorded for the owner. */
export default async function Shared({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ token }, sp, h] = await Promise.all([params, searchParams, headers()]);
  const ip = ipFromHeaders(h);
  const shared = await resolveShare(token, ip, 'viewed');
  const key = platformKey();
  if (!shared) {
    return (
      <main className="wrap narrow" style={{ paddingTop: '4rem' }}>
        <h1>This link is not available</h1>
        <p className="muted">It has expired, was revoked by its owner, or never existed. Ask the company for a new link.</p>
      </main>
    );
  }
  return (
    <>
      <header className="topbar"><div className="wrap"><span className="brand">AcquiCode <span>shared dossier</span></span><span className="right small muted">Read-only · shared by {shared.orgName}</span></div></header>
      <main className="wrap" style={{ paddingTop: '1.5rem' }}>
        <div className="kicker">{shared.label} · link expires {fmtDate(shared.expiresAt)}</div>
        <h1 style={{ marginTop: '0.2rem' }}>{shared.dossier.title}</h1>
        <div className="notice small">
          {shared.attestation === 'PLATFORM_ATTESTED'
            ? <>Analysed by the AcquiCode hosted runner directly from the source repository and signed with the platform key{key ? <> (<Link href="/.well-known/acquicode-signing-key.pem">{key.keyid}</Link>)</> : null}.</>
            : shared.attestation === 'SELF_ATTESTED'
              ? <>Analysed by the company where its code lives and signed with its own key. The analysis is deterministic: with access to the same commits you can reproduce the digest with <code>acquicode verify --reproduce</code>.</>
              : <>This dossier is not signed.</>}{' '}
          Check it independently at <Link href="/verify">/verify</Link> with the JSON and signed-manifest downloads below.
        </div>
        <DossierView d={shared.dossier} view={parseView(sp.view)} base={`/s/${token}`} downloads={`/api/s/${token}/download`} />
      </main>
      <Footer />
    </>
  );
}
