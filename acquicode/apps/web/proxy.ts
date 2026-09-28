import { NextResponse, type NextRequest } from 'next/server';

/**
 * Per-request CSP nonce. Scripts run only with the nonce; nothing from a
 * repository or a dossier is ever rendered as markup, and this policy is the
 * second line of defence.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const dev = process.env.NODE_ENV === 'development';
  const https = (process.env.APP_URL ?? '').startsWith('https://');
  // GitHub Enterprise Server: the setup page posts the App manifest to that host instead of github.com.
  let ghes = '';
  try {
    const origin = process.env.GITHUB_WEB_URL ? new URL(process.env.GITHUB_WEB_URL).origin : '';
    if (origin.startsWith('https://') && origin !== 'https://github.com') ghes = ` ${origin}`;
  } catch {
    ghes = '';
  }
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    `form-action 'self' https://github.com${ghes} https://checkout.stripe.com`,
    "frame-ancestors 'none'",
    ...(https ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

// Pages only. API routes set their own headers: downloads carry a sandbox CSP
// that must not be replaced by the page policy.
export const config = {
  matcher: [{ source: '/((?!api/|_next/static|_next/image|favicon.ico).*)' }],
};
