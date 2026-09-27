import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { config } from './config';
import { hashToken, randomToken } from './crypto';
import { isUuid, q, q1 } from './db';
import { HttpError } from './http';

export interface SessionUser {
  id: string;
  login: string;
  name: string | null;
  email: string | null;
}

export type Role = 'owner' | 'admin' | 'member' | 'viewer';

export interface OrgContext {
  user: SessionUser;
  org: { id: string; name: string; plan: string; retentionDays: number; enrichmentEnabled: boolean; creditsDossiers: number };
  role: Role;
  orgs: Array<{ id: string; name: string; role: Role }>;
}

const RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

export function sessionCookieName(): string {
  return config().APP_URL.startsWith('https://') ? '__Host-acq_session' : 'acq_session';
}

export const ORG_COOKIE = 'acq_org';

export async function createSession(userId: string, ip: string | null, userAgent: string | null): Promise<{ token: string; expires: Date }> {
  const token = randomToken('sess');
  const expires = new Date(Date.now() + config().SESSION_TTL_HOURS * 3_600_000);
  await q('INSERT INTO sessions (id_hash, user_id, expires_at, ip, user_agent) VALUES ($1, $2, $3, $4, $5)', [hashToken(token), userId, expires, ip, userAgent?.slice(0, 300) ?? null]);
  return { token, expires };
}

export function sessionCookie(token: string, expires: Date) {
  return {
    name: sessionCookieName(),
    value: token,
    options: { httpOnly: true, secure: config().APP_URL.startsWith('https://'), sameSite: 'lax' as const, path: '/', expires },
  };
}

export async function userFromSessionToken(token: string | undefined): Promise<SessionUser | null> {
  if (!token || token.length > 200) return null;
  const r = await q1<SessionUser & { last_seen_at: Date }>(
    `SELECT u.id, u.login, u.name, u.email, s.last_seen_at FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
  if (!r) return null;
  if (Date.now() - new Date(r.last_seen_at).getTime() > 5 * 60_000) {
    await q('UPDATE sessions SET last_seen_at = now() WHERE id_hash = $1', [hashToken(token)]);
  }
  return { id: r.id, login: r.login, name: r.name, email: r.email };
}

export async function currentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  return userFromSessionToken(jar.get(sessionCookieName())?.value);
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (token) await q('DELETE FROM sessions WHERE id_hash = $1', [hashToken(token)]);
}

async function loadOrgContext(user: SessionUser, preferred: string | undefined): Promise<OrgContext | null> {
  const orgs = await q<{ id: string; name: string; role: Role; plan: string; retention_days: number; enrichment_enabled: boolean; credits_dossiers: number }>(
    `SELECT o.id, o.name, m.role, o.plan, o.retention_days, o.enrichment_enabled, o.credits_dossiers
     FROM memberships m JOIN orgs o ON o.id = m.org_id WHERE m.user_id = $1 ORDER BY o.created_at`,
    [user.id],
  );
  if (!orgs.length) {
    // A user whose last organisation was deleted gets a fresh, empty workspace.
    const org = await q1<{ id: string }>('INSERT INTO orgs (name) VALUES ($1) RETURNING id', [`${user.name ?? user.login}'s workspace`]);
    await q("INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'owner')", [org!.id, user.id]);
    return loadOrgContext(user, org!.id);
  }
  const chosen = orgs.find((o) => o.id === preferred) ?? orgs[0]!;
  return {
    user,
    org: { id: chosen.id, name: chosen.name, plan: chosen.plan, retentionDays: chosen.retention_days, enrichmentEnabled: chosen.enrichment_enabled, creditsDossiers: chosen.credits_dossiers },
    role: chosen.role,
    orgs: orgs.map((o) => ({ id: o.id, name: o.name, role: o.role })),
  };
}

/** For pages: redirect to /login when signed out. */
export async function requirePageContext(minRole: Role = 'viewer'): Promise<OrgContext> {
  const user = await currentUser();
  if (!user) redirect('/login');
  const jar = await cookies();
  const pref = jar.get(ORG_COOKIE)?.value;
  const ctx = await loadOrgContext(user, isUuid(pref) ? pref : undefined);
  if (!ctx) redirect('/login?error=no-organisation');
  if (RANK[ctx.role] < RANK[minRole]) redirect('/app?error=forbidden');
  return ctx;
}

/** For route handlers: throw 401/403 instead of redirecting. */
export async function requireApiContext(minRole: Role = 'viewer'): Promise<OrgContext> {
  const user = await currentUser();
  if (!user) throw new HttpError(401, 'Sign in required');
  const jar = await cookies();
  const pref = jar.get(ORG_COOKIE)?.value;
  const ctx = await loadOrgContext(user, isUuid(pref) ? pref : undefined);
  if (!ctx) throw new HttpError(403, 'No organisation');
  if (RANK[ctx.role] < RANK[minRole]) throw new HttpError(403, `Requires the ${minRole} role`);
  return ctx;
}

export function hasRole(ctx: OrgContext, minRole: Role): boolean {
  return RANK[ctx.role] >= RANK[minRole];
}

/** Create or update a user from a GitHub identity, give them a personal organisation, accept pending invitations. */
export async function upsertGithubUser(gh: { id: number; login: string; name: string | null; email: string | null }): Promise<string> {
  const existing = await q1<{ id: string }>('SELECT id FROM users WHERE github_id = $1', [gh.id]);
  let userId: string;
  if (existing) {
    userId = existing.id;
    await q('UPDATE users SET login = $2, name = $3, email = COALESCE($4, email), last_login_at = now() WHERE id = $1', [userId, gh.login, gh.name, gh.email]);
  } else {
    const u = await q1<{ id: string }>('INSERT INTO users (github_id, login, name, email, last_login_at) VALUES ($1, $2, $3, $4, now()) RETURNING id', [gh.id, gh.login, gh.name, gh.email]);
    userId = u!.id;
  }
  await q('SELECT claim_invitations($1, $2)', [gh.id, userId]);
  const memberships = await q1<{ n: string }>('SELECT count(*)::text AS n FROM memberships WHERE user_id = $1', [userId]);
  if (memberships?.n === '0') {
    const org = await q1<{ id: string }>('INSERT INTO orgs (name) VALUES ($1) RETURNING id', [gh.name ? `${gh.name}'s workspace` : `${gh.login}'s workspace`]);
    await q("INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'owner')", [org!.id, userId]);
  }
  return userId;
}
