import { NextResponse } from 'next/server';
import { isUuid } from '@/lib/db';
import { assertSameOrigin, formHandler, HttpError } from '@/lib/http';
import { ORG_COOKIE, requireApiContext } from '@/lib/session';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';

export const POST = formHandler(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requireApiContext('viewer');
  const form = await req.formData();
  const org = String(form.get('org') ?? '');
  if (!isUuid(org) || !ctx.orgs.some((o) => o.id === org)) throw new HttpError(403, 'Not a member of that organisation');
  const res = NextResponse.redirect(new URL('/app', config().APP_URL), 303);
  res.cookies.set(ORG_COOKIE, org, { httpOnly: true, sameSite: 'lax', secure: config().APP_URL.startsWith('https://'), path: '/' });
  return res;
});
