import { assertSameOrigin, clientIp, formHandler, redirectTo } from '@/lib/http';
import { config } from '@/lib/config';
import { rateLimitIp } from '@/lib/ratelimit';
import { SETUP_COOKIE, setupEnabled, setupSession, setupTokenMatches } from '@/lib/setup';

export const dynamic = 'force-dynamic';

export const POST = formHandler(async (req: Request) => {
  assertSameOrigin(req);
  await rateLimitIp('setup', clientIp(req), 10, 900);
  if (!setupEnabled()) return redirectTo('/setup?error=Web setup is disabled on this deployment.');
  const form = await req.formData();
  if (!setupTokenMatches(String(form.get('token') ?? '').trim())) return redirectTo('/setup?error=That setup token is not correct.');
  const res = redirectTo('/setup');
  res.cookies.set(SETUP_COOKIE, setupSession(), { httpOnly: true, secure: config().APP_URL.startsWith('https://'), sameSite: 'lax', path: '/', maxAge: 1800 });
  return res;
});
