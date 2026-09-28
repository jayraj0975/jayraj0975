import Link from 'next/link';
import { headers } from 'next/headers';
import { Footer, TopBar } from '@/components/ui';

export default async function NotFound() {
  await headers(); // render per request so the page carries the CSP nonce
  return (
    <>
      <TopBar signedIn={false} />
      <main className="wrap narrow" style={{ paddingTop: '4rem', minHeight: '50vh' }}>
        <div className="kicker">404</div>
        <h1>This page does not exist</h1>
        <p className="muted">If you followed a share link, it may have expired or been revoked; ask whoever sent it for a new one.</p>
        <p className="row"><Link className="btn primary" href="/">Home</Link><Link className="btn" href="/sample">Sample dossier</Link></p>
      </main>
      <Footer />
    </>
  );
}
