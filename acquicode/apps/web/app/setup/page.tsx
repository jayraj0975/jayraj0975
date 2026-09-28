import Link from 'next/link';
import { cookies } from 'next/headers';
import { Footer, Notice, TopBar } from '@/components/ui';
import { config, stripeConfigured } from '@/lib/config';
import { signState } from '@/lib/crypto';
import { appReady, githubAppManifest, githubCreds, loginReady } from '@/lib/github-config';
import { currentUser } from '@/lib/session';
import { platformKey } from '@/lib/signing';
import { site } from '@/lib/site';
import { SETUP_COOKIE, setupEnabled, setupUnlocked } from '@/lib/setup';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Setup', robots: { index: false } };

function Check({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <li>
      <span className={ok ? 'status-satisfied' : 'status-attention'}>{ok ? '✓' : '○'}</span> <strong>{label}</strong>
      <div className="small muted">{detail}</div>
    </li>
  );
}

function defaultAppName(host: string): string {
  const label = host.split('.')[0] ?? host;
  return (label === 'acquicode' || label === 'www' ? 'AcquiCode' : `AcquiCode (${label})`).slice(0, 34);
}

export default async function Setup({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const c = config();
  const s = site();
  const [user, gh] = await Promise.all([currentUser(), githubCreds()]);
  const unlocked = setupUnlocked((await cookies()).get(SETUP_COOKIE)?.value);
  const connected = gh.source !== 'none';

  const org = typeof sp.org === 'string' && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(sp.org) ? sp.org : null;
  const name = typeof sp.name === 'string' && /^[\p{L}\p{N} ().-]{3,34}$/u.test(sp.name) ? sp.name : defaultAppName(s.host);
  const web = c.GITHUB_WEB_URL.replace(/\/+$/, '');
  const state = !connected && unlocked ? signState({ purpose: 'gh-manifest' }, 3600) : null;
  const action = state ? `${web}${org ? `/organizations/${encodeURIComponent(org)}` : ''}/settings/apps/new?state=${encodeURIComponent(state)}` : null;
  let signing = false;
  try {
    signing = !!platformKey();
  } catch {
    signing = false;
  }

  return (
    <>
      <TopBar signedIn={!!user} />
      <main className="wrap narrow" style={{ paddingTop: '2.5rem' }}>
        <div className="kicker">For the operator of {s.host}</div>
        <h1 style={{ marginTop: '0.3rem' }}>Setup</h1>
        <Notice params={sp} />

        {connected ? (
          <section className="card" style={{ margin: '1.25rem 0' }}>
            <h2 style={{ marginTop: 0 }}>GitHub is connected</h2>
            <p className="small">
              {gh.slug ? (
                <>
                  GitHub App <a href={`${web}/apps/${gh.slug}`}>{gh.slug}</a>
                  {gh.owner ? <> owned by {gh.owner}</> : null},{' '}
                </>
              ) : null}
              configured {gh.source === 'env' ? 'through environment variables' : 'through this page'}. Setup is closed.
            </p>
            {user ? (
              <Link className="btn primary" href="/app">Open your workspace</Link>
            ) : (
              <Link className="btn primary" href="/login">Sign in with GitHub</Link>
            )}
            <p className="small muted" style={{ marginTop: '0.9rem' }}>
              The first sign-in creates an organisation for that person. Next, connect repositories from <em>Add source</em>, which installs the App on the accounts and
              repositories you choose.
            </p>
          </section>
        ) : !setupEnabled() ? (
          <div className="notice warn" style={{ margin: '1.25rem 0' }}>
            This deployment is not connected to GitHub and web setup is disabled. Set <code>SETUP_TOKEN</code> (24 or more random characters) in the environment and
            restart, or set the GitHub variables directly (DEPLOYMENT.md, section 5).
          </div>
        ) : !unlocked ? (
          <section className="card" style={{ margin: '1.25rem 0' }}>
            <h2 style={{ marginTop: 0 }}>Unlock setup</h2>
            <p className="small">Enter the setup token from this deployment&apos;s environment (<code>SETUP_TOKEN</code>). Setup stays unlocked in this browser for 30 minutes.</p>
            <form action="/api/setup/unlock" method="post" className="row">
              <input name="token" type="password" required minLength={24} autoComplete="off" aria-label="Setup token" placeholder="Setup token" />
              <button className="btn primary" type="submit">Unlock</button>
            </form>
          </section>
        ) : (
          <section className="card" style={{ margin: '1.25rem 0' }}>
            <h2 style={{ marginTop: 0 }}>Connect GitHub</h2>
            <p className="small">
              AcquiCode signs people in with GitHub and reads the repositories they choose through a GitHub App. GitHub creates the App from the settings below;
              nothing is copied by hand, and the credentials are stored encrypted with this deployment&apos;s data keys.
            </p>
            <ul className="small">
              <li>Repository permissions, all read-only: contents, metadata, pull requests.</li>
              <li>Webhook: <code>{s.url}/api/github/webhook</code> (signed with a generated secret).</li>
              <li>Sign-in callback: <code>{s.url}/api/auth/github/callback</code>; installation setup: <code>{s.url}/api/github/setup</code>.</li>
              <li>Public, so the companies you work with can install it on their own repositories.</li>
            </ul>
            <form method="get" action="/setup" className="row" style={{ margin: '1rem 0' }}>
              <input name="name" type="text" defaultValue={name} maxLength={34} aria-label="App name" placeholder="App name" />
              <input name="org" type="text" defaultValue={org ?? ''} maxLength={39} aria-label="GitHub organisation (optional)" placeholder="GitHub organisation (optional)" />
              <button className="btn" type="submit">Update</button>
            </form>
            <form method="post" action={action!}>
              <input type="hidden" name="manifest" value={JSON.stringify(githubAppManifest(name))} />
              <button className="btn primary" type="submit">Create “{name}” on {org ? `the ${org} organisation` : 'my GitHub account'}</button>
            </form>
            <p className="small muted" style={{ marginTop: '0.9rem' }}>
              GitHub asks you to confirm, then returns here. App names are unique across GitHub; if the name is taken, change it above. Leave the organisation empty
              to create the App on your personal account.
            </p>
          </section>
        )}

        {unlocked || connected ? (
          <section className="card" style={{ margin: '1.25rem 0' }}>
            <h2 style={{ marginTop: 0 }}>Deployment checklist</h2>
            {unlocked ? (
              <ul className="checks-list">
                <Check ok={loginReady(gh)} label="GitHub sign-in" detail="The App's client id and secret. Without them nobody can sign in." />
                <Check ok={appReady(gh)} label="GitHub repository access" detail="The App's id, slug and private key. Without them, use the CLI, GitLab or ZIP uploads." />
                <Check ok={!!gh.webhookSecret} label="GitHub webhooks" detail="Keeps monitored repositories and installations in sync. Without a secret every delivery is rejected." />
                <Check ok={signing} label="Platform signing key" detail="PLATFORM_SIGNING_KEY. Without it hosted dossiers are unsigned and cannot be platform-attested." />
                <Check ok={stripeConfigured()} label="Payments" detail="STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET. Without them every organisation stays on the free plan." />
                <Check ok={!!s.supportEmail} label="Contact address" detail="CONTACT_EMAIL (and SECURITY_EMAIL). Shown in the footer, the legal pages and security.txt." />
                <Check ok={s.operatorNamed} label="Legal entity" detail="LEGAL_ENTITY: the company named in the Terms and Privacy pages." />
                <Check ok={!!c.HOSTING_PROVIDER} label="Hosting provider" detail="HOSTING_PROVIDER: listed on the subprocessors page." />
                <Check ok={c.TRUST_PROXY > 0} label="Client addresses" detail="TRUST_PROXY: the number of proxies in front of the app, so rate limits and audit events see real client IPs." />
              </ul>
            ) : setupEnabled() ? (
              <form action="/api/setup/unlock" method="post" className="row">
                <input name="token" type="password" required minLength={24} autoComplete="off" aria-label="Setup token" placeholder="Setup token" />
                <button className="btn" type="submit">Show the checklist</button>
              </form>
            ) : (
              <p className="small muted">Set SETUP_TOKEN to see the full checklist here.</p>
            )}
          </section>
        ) : null}
      </main>
      <Footer />
    </>
  );
}
