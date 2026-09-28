import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyState } from '@/lib/crypto';
import { githubIdentity, githubIdentityWithInstallations } from '@/lib/github';
import { clientIp, handler, HttpError, redirectTo } from '@/lib/http';
import { createSession, hasRole, requireApiContext, sessionCookie, upsertGithubUser } from '@/lib/session';
import { rateLimitIp } from '@/lib/ratelimit';
import { q, q1, withOrg } from '@/lib/db';
import { audit } from '@/lib/audit';
import { connectInstallation } from '@/lib/installations';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';

type State = {
  purpose: string;
  nonce?: string;
  org?: string;
  user?: string;
  installation?: number;
};

export const GET = handler(async (req: Request) => {
  const url = new URL(req.url);
  await rateLimitIp('login', clientIp(req), 30, 600);
  const state = verifyState<State>(url.searchParams.get('state'));
  const code = url.searchParams.get('code');
  // "install" arrives here directly when the App requests user authorisation during installation.
  if (state && (state.purpose === 'install-verify' || state.purpose === 'install')) {
    const installation = state.purpose === 'install' ? Number(url.searchParams.get('installation_id')) : Number(state.installation);
    return verifyAndConnect(req, state, installation, code);
  }
  const jar = await cookies();
  if (!state || state.purpose !== 'login' || jar.get('acq_oauth')?.value !== state.nonce) return redirectTo('/login?error=Sign-in expired or was started elsewhere. Try again.');
  if (!code) return redirectTo('/login?error=GitHub did not return an authorisation code.');
  const gh = await githubIdentity(code);
  const userId = await upsertGithubUser(gh);
  const { token, expires } = await createSession(userId, clientIp(req), req.headers.get('user-agent'));
  const orgs = await q<{ org_id: string }>('SELECT org_id FROM memberships WHERE user_id = $1', [userId]);
  for (const o of orgs) await withOrg(o.org_id, (c) => audit(c, o.org_id, { type: 'user', id: userId }, 'auth.login', null, { method: 'github' }, clientIp(req)));
  const res = NextResponse.redirect(new URL('/app', config().APP_URL), 303);
  const c = sessionCookie(token, expires);
  res.cookies.set(c.name, c.value, c.options);
  res.cookies.delete({ name: 'acq_oauth', path: '/api/auth/github' });
  return res;
});

/**
 * Bind an installation only if (1) the signed state was issued to this session
 * for this organisation by an admin, (2) the GitHub account that just
 * authorised is the one this user signed in with, and (3) GitHub lists the
 * installation among those that account can access.
 */
async function verifyAndConnect(req: Request, state: State, installation: number, code: string | null): Promise<Response> {
  const fail = (msg: string) => redirectTo(`/app/connect?error=${encodeURIComponent(msg)}`);
  try {
    const ctx = await requireApiContext('viewer');
    if (state.user !== ctx.user.id || state.org !== ctx.org.id || !hasRole(ctx, 'admin')) return fail('The installation link belongs to another session or organisation. Start again from Add source.');
    if (!Number.isSafeInteger(installation) || installation <= 0) return fail('GitHub did not return an installation id.');
    if (!code) return fail('GitHub did not return an authorisation code.');
    const { identity, installations } = await githubIdentityWithInstallations(code);
    const me = await q1<{ github_id: string | null }>('SELECT github_id::text FROM users WHERE id = $1', [ctx.user.id]);
    if (!me?.github_id || me.github_id !== String(identity.id)) return fail(`You authorised GitHub as ${identity.login}, which is not the account you are signed in with.`);
    if (!installations.has(installation)) return fail(`GitHub does not list that installation as accessible to ${identity.login}. Ask an owner of the GitHub account to connect it.`);
    const r = await connectInstallation(ctx, installation, clientIp(req));
    return redirectTo(`/app?notice=${encodeURIComponent(`Connected ${r.account}: ${r.added} repositor${r.added === 1 ? 'y' : 'ies'} added${r.skipped ? ` (${r.skipped} already present or over the plan limit)` : ''}. Choose one and run a scan.`)}`);
  } catch (err) {
    if (err instanceof HttpError) return err.status === 401 ? redirectTo('/login') : fail(err.message);
    throw err;
  }
}
