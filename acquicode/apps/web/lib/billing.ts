import { createHmac } from 'node:crypto';
import { safeEqual } from './crypto';

/** Stripe webhook signature: HMAC-SHA256 of `${t}.${payload}`, five-minute tolerance. */
export function verifyStripeSignature(payload: string, header: string | null, secret: string, now = Math.floor(Date.now() / 1000)): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=') as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(now - t) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  return header.split(',').some((kv) => kv.startsWith('v1=') && safeEqual(kv.slice(3), expected));
}
