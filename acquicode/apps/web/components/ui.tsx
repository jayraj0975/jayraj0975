import Link from 'next/link';
import type { ProvenanceState, QuestionStatus } from '@acquicode/engine';

const STATE_LABEL: Record<ProvenanceState, string> = {
  VERIFIED: 'Verified',
  OBSERVED: 'Observed',
  DERIVED: 'Derived',
  USER_ASSERTED: 'Company-asserted',
  INFERRED: 'Inferred',
  UNKNOWN: 'Unknown',
  CONFLICTING: 'Conflicting',
  UNVERIFIABLE: 'Unverifiable',
  STALE: 'Stale',
};

const STATE_HELP: Record<ProvenanceState, string> = {
  VERIFIED: 'Observed and independently checked',
  OBSERVED: 'Read directly from the repository or a named source',
  DERIVED: 'Computed deterministically from observed facts',
  USER_ASSERTED: 'Stated by the company; not proof',
  INFERRED: 'Heuristic reading; raises questions, never blocks',
  UNKNOWN: 'No evidence either way',
  CONFLICTING: 'Sources disagree',
  UNVERIFIABLE: 'Cannot be checked against the repository',
  STALE: 'Predates later changes to what it describes',
};

export function State({ s }: { s: ProvenanceState }) {
  return (
    <span className={`pill state-${s.toLowerCase()}`} title={STATE_HELP[s]}>
      {STATE_LABEL[s]}
    </span>
  );
}

export function Mat({ m }: { m: string }) {
  return <span className={`pill mat-${m}`}>{m}</span>;
}

const STATUS_LABEL: Record<QuestionStatus, string> = {
  SATISFIED: 'Satisfied',
  ATTENTION: 'Attention',
  BLOCKING: 'Blocking',
  UNKNOWN: 'Unknown',
  NOT_APPLICABLE: 'Not applicable',
};

export function Status({ s }: { s: QuestionStatus }) {
  return <span className={`pill status-${s.toLowerCase()}`}>{STATUS_LABEL[s]}</span>;
}

export function Readiness({ level }: { level: string | null | undefined }) {
  const l = level ?? 'NONE';
  return <span className={`readiness ${l}`}>{level ?? 'NOT SCANNED'}</span>;
}

export function TopBar({ signedIn, current }: { signedIn: boolean; current?: string }) {
  return (
    <header className="topbar">
      <div className="wrap">
        <Link href={signedIn ? '/app' : '/'} className="brand">
          AcquiCode <span>diligence</span>
        </Link>
        <nav className="nav" aria-label="Main">
          {signedIn ? (
            <>
              <Link href="/app" aria-current={current === 'app' ? 'page' : undefined}>Repositories</Link>
              <Link href="/app/connect" aria-current={current === 'connect' ? 'page' : undefined}>Add source</Link>
              <Link href="/app/settings" aria-current={current === 'settings' ? 'page' : undefined}>Settings</Link>
              <Link href="/verify" aria-current={current === 'verify' ? 'page' : undefined}>Verify a dossier</Link>
            </>
          ) : (
            <>
              <Link href="/sample">Sample dossier</Link>
              <Link href="/#how">How it works</Link>
              <Link href="/#pricing">Pricing</Link>
              <Link href="/verify">Verify a dossier</Link>
            </>
          )}
        </nav>
        <div className="right">
          {signedIn ? (
            <form action="/api/auth/logout" method="post" className="inline">
              <button className="btn small" type="submit">Sign out</button>
            </form>
          ) : (
            <Link className="btn small primary" href="/login">Analyze a repository</Link>
          )}
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap spread">
        <span>AcquiCode · evidence-graded technical diligence. Not legal advice.</span>
        <span className="row">
          <Link href="/security">Security &amp; data handling</Link>
          <Link href="/.well-known/acquicode-signing-key.pem">Platform signing key</Link>
        </span>
      </div>
    </footer>
  );
}

export function Notice({ params }: { params: Record<string, string | string[] | undefined> }) {
  const notice = typeof params.notice === 'string' ? params.notice : null;
  const error = typeof params.error === 'string' ? params.error : null;
  if (!notice && !error) return null;
  return <div className={`notice${error ? ' error' : ''}`} role="status">{(error ?? notice)!.slice(0, 300)}</div>;
}

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}
