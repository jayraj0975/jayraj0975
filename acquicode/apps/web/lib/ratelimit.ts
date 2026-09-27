import { q1 } from './db';
import { HttpError } from './errors';

/**
 * Fixed-window rate limiting stored in Postgres, so limits hold across every
 * web instance without another moving part.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<void> {
  const r = await q1<{ count: number }>(
    `INSERT INTO rate_limits (key, window_start, count)
     VALUES ($1, to_timestamp(floor(extract(epoch from now()) / $2) * $2), 1)
     ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
     RETURNING count`,
    [key, windowSeconds],
  );
  if ((r?.count ?? 0) > limit) throw new HttpError(429, 'Too many requests; slow down and try again shortly');
}

/**
 * Per-client limit. Without a trusted proxy the client address is unknown, so
 * all anonymous callers share one larger bucket rather than one caller being
 * able to exhaust a small one for everybody.
 */
export async function rateLimitIp(prefix: string, ip: string, limit: number, windowSeconds: number): Promise<void> {
  if (ip === 'unknown') return rateLimit(`${prefix}:shared`, limit * 20, windowSeconds);
  return rateLimit(`${prefix}:${ip}`, limit, windowSeconds);
}
