import { NextResponse } from 'next/server';
import { config } from './config';
import { HttpError } from './errors';

export { HttpError };

export function jsonError(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/** Wrap a route handler: HttpErrors become JSON responses; anything else is a generic 500 (details only in logs). */
export function handler<A extends unknown[]>(fn: (...args: A) => Promise<Response>): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return apiHeaders(await fn(...args));
    } catch (err) {
      if (err instanceof HttpError) return apiHeaders(jsonError(err.status, err.message));
      // Next.js control-flow errors (redirect/notFound) must propagate.
      if (err && typeof err === 'object' && 'digest' in err && String((err as { digest: unknown }).digest).startsWith('NEXT_')) throw err;
      const { log, sanitizeError } = await import('./log');
      log().error({ err: sanitizeError(err) }, 'request failed');
      return apiHeaders(jsonError(500, 'Internal error'));
    }
  };
}

/** API responses are data, never pages: deny everything unless the route set its own policy (e.g. the sandboxed HTML export). */
const API_CSP = "default-src 'none'; frame-ancestors 'none'; sandbox";
function apiHeaders(res: Response): Response {
  try {
    if (!res.headers.has('content-security-policy')) res.headers.set('content-security-policy', API_CSP);
  } catch {
    // Immutable headers (Response.redirect): nothing to render, nothing to protect.
  }
  return res;
}

/**
 * For HTML form posts: errors send the user back where they came from with a
 * readable message instead of a JSON body.
 */
export function formHandler<A extends unknown[]>(fn: (...args: A) => Promise<Response>): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err && typeof err === 'object' && 'digest' in err && String((err as { digest: unknown }).digest).startsWith('NEXT_')) throw err;
      const req = args[0] as Request;
      let message = 'Something went wrong; nothing was changed.';
      if (err instanceof HttpError) {
        if (err.status === 401) return redirectTo('/login');
        message = err.message;
      } else {
        const { log, sanitizeError } = await import('./log');
        log().error({ err: sanitizeError(err) }, 'form request failed');
      }
      const appOrigin = new URL(config().APP_URL).origin;
      let back = '/app';
      const ref = req.headers.get('referer');
      if (ref) {
        try {
          const u = new URL(ref);
          if (u.origin === appOrigin) {
            u.searchParams.delete('notice');
            u.searchParams.delete('error');
            back = `${u.pathname}${u.search}`;
          }
        } catch {
          /* ignore */
        }
      }
      return redirectTo(`${back}${back.includes('?') ? '&' : '?'}error=${encodeURIComponent(message)}`);
    }
  };
}

/**
 * Cookie-authenticated mutations must come from our own origin. SameSite=Lax
 * already blocks most cross-site POSTs; this closes the rest.
 */
export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get('origin');
  const expected = new URL(config().APP_URL).origin;
  if (origin) {
    if (origin !== expected) throw new HttpError(403, 'Cross-origin request refused');
    return;
  }
  const fetchSite = req.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') throw new HttpError(403, 'Cross-origin request refused');
}

export function clientIp(req: Request): string {
  return ipFromHeaders(req.headers);
}

/**
 * The client address as seen by the outermost trusted proxy. Proxies append to
 * X-Forwarded-For, so everything left of the entries they added is whatever
 * the client chose to send; only the entry TRUST_PROXY hops from the right is
 * trustworthy. With no trusted proxy the header is ignored entirely.
 */
export function ipFromHeaders(h: Headers, hops = config().TRUST_PROXY): string {
  if (hops < 1) return 'unknown';
  const entries = (h.get('x-forwarded-for') ?? '').split(',').map((e) => e.trim()).filter(Boolean);
  const ip = entries[entries.length - hops];
  return ip && /^[0-9a-fA-F:.]{2,45}$/.test(ip) ? ip : 'unknown';
}

export async function readJsonBody<T>(req: Request, maxBytes: number): Promise<T> {
  const len = Number(req.headers.get('content-length') ?? '0');
  if (len > maxBytes) throw new HttpError(413, 'Request body too large');
  const text = await req.text();
  if (Buffer.byteLength(text) > maxBytes) throw new HttpError(413, 'Request body too large');
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, 'Body must be JSON');
  }
}

export function redirectTo(path: string, status = 303): NextResponse {
  return NextResponse.redirect(new URL(path, config().APP_URL), status);
}
