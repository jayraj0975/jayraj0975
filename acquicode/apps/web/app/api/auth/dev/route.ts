import { NextResponse } from 'next/server';
import { devLoginEnabled, config } from '@/lib/config';
import { assertSameOrigin, clientIp, formHandler, HttpError } from '@/lib/http';
import { createSession, sessionCookie, upsertGithubUser } from '@/lib/session';
import { devGithubId } from '@/lib/github';

export const dynamic = 'force-dynamic';

/** Development-only sign-in. config() refuses to start production with it enabled. */
export const POST = formHandler(async (req: Request) => {
  if (!devLoginEnabled()) throw new HttpError(404, 'Not found');
  assertSameOrigin(req);
  const form = await req.formData();
  const login = String(form.get('login') ?? '');
  if (!/^[A-Za-z0-9-]{1,39}$/.test(login)) throw new HttpError(400, 'Invalid login');
  const userId = await upsertGithubUser({ id: devGithubId(login), login, name: login, email: null });
  const { token, expires } = await createSession(userId, clientIp(req), req.headers.get('user-agent'));
  const res = NextResponse.redirect(new URL('/app', config().APP_URL), 303);
  const c = sessionCookie(token, expires);
  res.cookies.set(c.name, c.value, c.options);
  return res;
});
