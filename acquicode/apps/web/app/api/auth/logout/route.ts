import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { config } from '@/lib/config';
import { assertSameOrigin, formHandler } from '@/lib/http';
import { destroySession, sessionCookieName } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const POST = formHandler(async (req: Request) => {
  assertSameOrigin(req);
  const jar = await cookies();
  await destroySession(jar.get(sessionCookieName())?.value);
  const res = NextResponse.redirect(new URL('/', config().APP_URL), 303);
  res.cookies.delete(sessionCookieName());
  return res;
});
