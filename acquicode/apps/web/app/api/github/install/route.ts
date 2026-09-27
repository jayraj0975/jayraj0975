import { NextResponse } from 'next/server';
import { signState } from '@/lib/crypto';
import { installUrl } from '@/lib/github';
import { assertSameOrigin, formHandler } from '@/lib/http';
import { requireApiContext } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const POST = formHandler(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requireApiContext('admin');
  return NextResponse.redirect(installUrl(signState({ purpose: 'install', org: ctx.org.id, user: ctx.user.id }, 1800)), 303);
});
