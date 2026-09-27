import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyState } from '@/lib/crypto';
import { githubIdentity } from '@/lib/github';
import { clientIp, handler, redirectTo } from '@/lib/http';
import { createSession, sessionCookie, upsertGithubUser } from '@/lib/session';
import { rateLimitIp } from '@/lib/ratelimit';
import { q } from '@/lib/db';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: Request) => {
  const url = new URL(req.url);
  await rateLimitIp('login', clientIp(req), 30, 600);
  const state = verifyState<{ purpose: string; nonce: string }>(url.searchParams.get('state'));
  const jar = await cookies();
  if (!state || state.purpose !== 'login' || jar.get('acq_oauth')?.value !== state.nonce) return redirectTo('/login?error=Sign-in expired or was started elsewhere. Try again.');
  const code = url.searchParams.get('code');
  if (!code) return redirectTo('/login?error=GitHub did not return an authorisation code.');
  const gh = await githubIdentity(code);
  const userId = await upsertGithubUser(gh);
  const { token, expires } = await createSession(userId, clientIp(req), req.headers.get('user-agent'));
  const orgs = await q<{ org_id: string }>('SELECT org_id FROM memberships WHERE user_id = $1', [userId]);
  const { audit } = await import('@/lib/audit');
  const { withOrg } = await import('@/lib/db');
  for (const o of orgs) await withOrg(o.org_id, (c) => audit(c, o.org_id, { type: 'user', id: userId }, 'auth.login', null, { method: 'github' }, clientIp(req)));
  const res = NextResponse.redirect(new URL('/app', config().APP_URL), 303);
  const c = sessionCookie(token, expires);
  res.cookies.set(c.name, c.value, c.options);
  res.cookies.delete({ name: 'acq_oauth', path: '/api/auth/github' });
  return res;
});
