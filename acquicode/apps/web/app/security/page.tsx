import { Footer, TopBar } from '@/components/ui';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Security and data handling' };

export default async function Security() {
  const user = await currentUser();
  return (
    <>
      <TopBar signedIn={!!user} />
      <main className="wrap narrow" style={{ paddingTop: '2rem' }}>
        <h1>Security and data handling</h1>
        <p className="lead muted">Source code is the most sensitive thing a company owns. This is exactly what happens to it.</p>
        <h2>Two ways to run</h2>
        <p><strong>Local (CLI or CI).</strong> The analyzer runs on your infrastructure. The dossier contains paths, hashes, commit metadata and short structured values (license identifiers, URLs, trailer text), never source code. You can drop even those with <code>--omit-extracts</code>. Uploading a dossier is optional.</p>
        <p><strong>Hosted.</strong> For GitHub, access is granted per repository through a GitHub App with read-only permissions (contents, metadata, pull requests). Each scan mints a token scoped to one repository that expires within an hour and is never stored. The repository is cloned into an isolated working directory, analysed in a separate process with memory and time limits, and deleted when the scan ends, successful or not. Uploaded archives are deleted after analysis. GitLab project tokens are encrypted at rest and decrypted only for the clone.</p>
        <h2>What we keep</h2>
        <ul>
          <li>The dossier, encrypted with AES-256-GCM before it is written to storage, for your organisation&apos;s retention period (default 365 days, configurable 7–3650). After that the body is deleted; the digest and readiness remain as your snapshot ledger.</li>
          <li>Audit events for sign-ins, repository changes, scans, share-link views, declaration changes and deletions. The audit table rejects updates.</li>
        </ul>
        <h2>What we never do</h2>
        <ul>
          <li>Send your code to a language model. There is no LLM in the analysis or in the report.</li>
          <li>Train anything on your repositories.</li>
          <li>Send private package names to public registries. Public package names and versions are sent to OSV.dev, npm and PyPI only when enrichment is enabled for your organisation.</li>
          <li>Reproduce secret values. Detected credentials are identified by a fingerprint and a four-character prefix.</li>
          <li>Log repository contents, tokens or cookies.</li>
        </ul>
        <h2>Isolation</h2>
        <p>Every organisation-scoped table is protected by PostgreSQL row-level security keyed on the organisation of the current transaction, forced for the table owner, and the application role cannot bypass it. A query that forgets a filter returns nothing rather than another customer&apos;s data.</p>
        <h2>Deletion</h2>
        <p>Deleting a repository removes its scans, dossiers, declarations, change history and share links. Deleting an organisation removes everything it owns. Both are immediate and irreversible.</p>
        <h2>Verification</h2>
        <p>Hosted dossiers are signed (DSSE over an in-toto statement, Ed25519). The platform public key is published at <a href="/.well-known/acquicode-signing-key.pem">/.well-known/acquicode-signing-key.pem</a>. Anyone can check a dossier at <a href="/verify">/verify</a> without signing in.</p>
        <h2>Reporting a vulnerability</h2>
        <p>See SECURITY.md in the source repository for the disclosure process.</p>
      </main>
      <Footer />
    </>
  );
}
