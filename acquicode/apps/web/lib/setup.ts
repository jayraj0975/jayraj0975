import { createHash } from 'node:crypto';
import { config } from './config';
import { safeEqual, signState, verifyState } from './crypto';

/**
 * Operator setup. Before GitHub is connected nobody can sign in, so /setup is
 * unlocked with SETUP_TOKEN instead of an account. The unlocked state is a
 * signed, 30-minute, HttpOnly cookie; the token itself never appears in a URL.
 */
export const SETUP_COOKIE = 'acq_setup';

export function setupEnabled(): boolean {
  return !!config().SETUP_TOKEN;
}

export function setupTokenMatches(candidate: string): boolean {
  const expected = config().SETUP_TOKEN;
  if (!expected || !candidate) return false;
  const h = (v: string) => createHash('sha256').update(v).digest('hex');
  return safeEqual(h(candidate), h(expected));
}

export function setupSession(): string {
  return signState({ purpose: 'setup' }, 1800);
}

export function setupUnlocked(cookie: string | undefined | null): boolean {
  if (!setupEnabled() || !cookie) return false;
  return verifyState<{ purpose: string }>(cookie)?.purpose === 'setup';
}
