import { redirect } from 'next/navigation';
import { Footer, Notice, TopBar } from '@/components/ui';
import { devLoginEnabled, githubLoginConfigured } from '@/lib/config';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign in' };

export default async function Login({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (await currentUser()) redirect('/app');
  const params = await searchParams;
  const github = githubLoginConfigured();
  const dev = devLoginEnabled();
  return (
    <>
      <TopBar signedIn={false} />
      <main className="wrap narrow" style={{ paddingTop: '3rem' }}>
        <h1>Sign in</h1>
        <Notice params={params} />
        {github ? (
          <form action="/api/auth/github/start" method="post">
            <button className="btn primary" type="submit">Continue with GitHub</button>
          </form>
        ) : (
          <div className="notice warn">GitHub sign-in is not configured on this deployment. An administrator must set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET (see DEPLOYMENT.md).</div>
        )}
        <p className="small muted" style={{ marginTop: '1.25rem' }}>
          Signing in reads your GitHub identity only. Repository access is granted separately, per repository, through the AcquiCode GitHub App, with read-only permissions.
        </p>
        {dev ? (
          <div className="card" style={{ marginTop: '2rem' }}>
            <h3>Development sign-in</h3>
            <p className="small muted">Enabled because ACQUICODE_DEV_LOGIN=1 outside production. Never available in production builds.</p>
            <form action="/api/auth/dev" method="post" className="row">
              <input type="text" name="login" placeholder="github-login" required pattern="[A-Za-z0-9-]{1,39}" aria-label="Login" />
              <button className="btn" type="submit">Sign in as this user</button>
            </form>
          </div>
        ) : null}
      </main>
      <Footer />
    </>
  );
}
