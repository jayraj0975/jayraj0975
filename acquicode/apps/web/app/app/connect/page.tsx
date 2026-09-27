import { Notice, TopBar } from '@/components/ui';
import { requirePageContext, hasRole } from '@/lib/session';
import { config, githubAppConfigured } from '@/lib/config';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Add source' };

export default async function Connect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requirePageContext();
  const params = await searchParams;
  const admin = hasRole(ctx, 'admin');
  const member = hasRole(ctx, 'member');
  const app = config().APP_URL;
  return (
    <>
      <TopBar signedIn current="connect" />
      <main className="wrap" style={{ paddingTop: '1.5rem' }}>
        <h1>Add a source</h1>
        <Notice params={params} />
        <div className="grid2">
          <section className="card">
            <h2>GitHub</h2>
            <p className="small">Install the AcquiCode GitHub App on the repositories you choose. Permissions are read-only: contents, metadata and pull requests (for review evidence). Tokens are minted per scan and expire within an hour.</p>
            {githubAppConfigured() ? (
              admin ? (
                <form action="/api/github/install" method="post"><button className="btn primary" type="submit">Connect GitHub repositories</button></form>
              ) : (
                <p className="muted small">Ask an admin of {ctx.org.name} to connect GitHub.</p>
              )
            ) : (
              <p className="notice warn small">The GitHub App is not configured on this deployment (GITHUB_APP_ID, GITHUB_APP_SLUG, GITHUB_APP_PRIVATE_KEY). Use the CLI, GitLab or a ZIP meanwhile.</p>
            )}
          </section>

          <section className="card">
            <h2>GitLab</h2>
            <p className="small">Create a project access token with <code>read_repository</code> and <code>read_api</code>. It is encrypted at rest and used only to clone during a scan.</p>
            {admin ? (
              <form action="/api/repos/gitlab" method="post">
                <div className="field"><label htmlFor="gl-url">Project URL</label><input id="gl-url" name="url" type="url" required placeholder="https://gitlab.com/group/project" /></div>
                <div className="field"><label htmlFor="gl-token">Project access token</label><input id="gl-token" name="token" type="password" required autoComplete="off" /></div>
                <button className="btn" type="submit">Connect project</button>
              </form>
            ) : <p className="muted small">Admins can connect GitLab projects.</p>}
          </section>

          <section className="card">
            <h2>Upload a ZIP</h2>
            <p className="small">For code that is not in a forge. Without git history, ownership and AI-development evidence are reported as unknown. The archive is deleted after analysis.</p>
            {member ? (
              <form action="/api/uploads" method="post" encType="multipart/form-data">
                <div className="field"><label htmlFor="up-name">Name</label><input id="up-name" name="name" type="text" placeholder="payments-service" /></div>
                <div className="field"><label htmlFor="up-file">Archive (.zip, up to {config().MAX_UPLOAD_MB} MB)</label><input id="up-file" name="archive" type="file" accept=".zip,application/zip" required /></div>
                <button className="btn" type="submit">Upload and analyse</button>
              </form>
            ) : <p className="muted small">Members can upload archives.</p>}
          </section>

          <section className="card">
            <h2>CLI (code never leaves your machine)</h2>
            <p className="small">Run the analysis where the code lives, then push only the dossier. Create an API token in <a href="/app/settings#tokens">Settings</a>.</p>
            <pre className="small">{`acquicode keygen --out keys
acquicode scan . --sign-key keys/acquicode-signing.key.pem
acquicode push acquicode-out/dossier.json \\
  --envelope acquicode-out/dossier.dsse.json \\
  --key keys/acquicode-signing.pub.pem \\
  --server ${app} --token $ACQUICODE_TOKEN`}</pre>
            <p className="small muted">In CI, add <code>--fail-on blocked</code> to stop a release that would be BLOCKED.</p>
          </section>
        </div>
      </main>
    </>
  );
}
