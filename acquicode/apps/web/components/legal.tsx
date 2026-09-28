import Link from 'next/link';
import { Footer, TopBar } from './ui';

export const LEGAL_UPDATED = '28 September 2026';

export function LegalPage({ title, signedIn, children }: { title: string; signedIn: boolean; children: React.ReactNode }) {
  return (
    <>
      <TopBar signedIn={signedIn} />
      <main className="wrap narrow legal" style={{ paddingTop: '2rem' }}>
        <nav className="small muted" aria-label="Legal">
          <Link href="/legal/terms">Terms</Link> · <Link href="/legal/privacy">Privacy</Link> · <Link href="/legal/subprocessors">Subprocessors</Link> · <Link href="/security">Security</Link>
        </nav>
        <h1>{title}</h1>
        <p className="small muted">Last updated {LEGAL_UPDATED}.</p>
        {children}
      </main>
      <Footer />
    </>
  );
}

export function Contact({ email, fallback }: { email: string | null; fallback: string }) {
  return email ? <a href={`mailto:${email}`}>{email}</a> : <>{fallback}</>;
}
