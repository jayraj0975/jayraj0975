import { NextResponse } from 'next/server';
import { signState } from '@/lib/crypto';
import { oauthAuthorizeUrl } from '@/lib/github';
import { assertSameOrigin, clientIp, formHandler } from '@/lib/http';
import { rateLimitIp } from '@/lib/ratelimit';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';

export const POST = formHandler(async (req: Request) => {
  assertSameOrigin(req);
  await rateLimitIp('login', clientIp(req), 30, 600);
  const nonce = crypto.randomUUID();
  const res = NextResponse.redirect(oauthAuthorizeUrl(signState({ purpose: 'login', nonce })), 303);
  // Binds the OAuth round trip to this browser (login CSRF protection).
  res.cookies.set('acq_oauth', nonce, { httpOnly: true, secure: config().APP_URL.startsWith('https://'), sameSite: 'lax', path: '/api/auth/github', maxAge: 600 });
  return res;
});
