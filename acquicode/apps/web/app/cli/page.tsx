import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import Link from 'next/link';
import { ANALYZER_VERSION, RULES_VERSION } from '@acquicode/engine';
import { Footer, TopBar } from '@/components/ui';
import { currentUser } from '@/lib/session';
import { site } from '@/lib/site';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'CLI', description: 'Run AcquiCode where your code lives. Nothing leaves your machine unless you push the dossier.' };

async function checksum(): Promise<string | null> {
  try {
    return (await readFile(join(process.cwd(), 'public/cli/acquicode.mjs.sha256'), 'utf8')).split(/\s+/)[0] ?? null;
  } catch {
    return null;
  }
}

export default async function Cli() {
  const [user, sum] = await Promise.all([currentUser(), checksum()]);
  const { url } = site();
  const cli = `${url}/cli/acquicode.mjs`;
  return (
    <>
      <TopBar signedIn={!!user} />
      <main className="wrap narrow" style={{ paddingTop: '2rem' }}>
        <div className="kicker">Free · runs where your code lives</div>
        <h1>The AcquiCode CLI</h1>
        <p className="lead muted">
          The same analysis engine the hosted service runs, as a single file. It reads your repository with git, writes the dossier to disk, and sends nothing
          anywhere unless you ask it to.
        </p>
        <p className="small muted">Version {ANALYZER_VERSION}, rules {RULES_VERSION}. Requires Node.js 22 or newer and git.</p>

        <h2>Install</h2>
        {sum ? (
          <>
            <pre>{`curl -fsSL ${cli} -o acquicode.mjs
echo "${sum}  acquicode.mjs" | shasum -a 256 -c -`}</pre>
            <p className="small muted">The checksum confirms the download is intact. <a href="/cli/acquicode.mjs.sha256">acquicode.mjs.sha256</a></p>
          </>
        ) : (
          <div className="notice warn">The CLI build is not available on this deployment.</div>
        )}

        <h2>Analyse a repository</h2>
        <pre>{`cd your-repo
node acquicode.mjs scan .                 # writes ./acquicode-out/dossier.{html,json} and an SBOM
open acquicode-out/dossier.html`}</pre>
        <p className="small">
          Add <code>--osv</code> to check public dependencies against OSV.dev (sends package names and versions only). Declarations live in{' '}
          <code>acquicode.yml</code> in the repository; see the <Link href="/sample">sample dossier</Link> for what the output covers.
        </p>

        <h2>Sign it, and let anyone verify it</h2>
        <pre>{`node acquicode.mjs keygen --out .acquicode-keys
node acquicode.mjs scan . --sign-key .acquicode-keys/acquicode-signing.key.pem

# anyone with the same commits:
node acquicode.mjs verify acquicode-out/dossier.json \\
  --envelope acquicode-out/dossier.dsse.json --key acquicode-signing.pub.pem --reproduce .`}</pre>
        <p className="small muted">Reproduction re-runs the analysis and must produce the identical digest. Signed dossiers can also be checked on the <Link href="/verify">verify page</Link>.</p>

        <h2>Deliver it without sharing code</h2>
        <pre>{`node acquicode.mjs push acquicode-out/dossier.json --server ${url} --token $ACQUICODE_TOKEN \\
  --envelope acquicode-out/dossier.dsse.json --key .acquicode-keys/acquicode-signing.pub.pem`}</pre>
        <p className="small">
          The token comes from your workspace settings, or from a buyer&apos;s dossier request. Tokens can only upload dossiers; they cannot read anything.
        </p>

        <h2>In CI (GitHub Actions)</h2>
        <pre>{`- uses: actions/checkout@v5
  with: { fetch-depth: 0 }          # full history: ownership and AI evidence need it
- run: git fetch origin 'refs/notes/*:refs/notes/*' || true
- run: |
    curl -fsSL ${cli} -o "$RUNNER_TEMP/acquicode.mjs"
    node "$RUNNER_TEMP/acquicode.mjs" scan . --osv --fail-on blocked
- uses: actions/upload-artifact@v4
  if: always()
  with: { name: acquicode-dossier, path: acquicode-out }`}</pre>
        <p className="small muted"><code>--fail-on blocked</code> fails the job when the dossier is BLOCKED (a live credential, for example), so the issue is caught before a buyer sees it.</p>
      </main>
      <Footer />
    </>
  );
}
