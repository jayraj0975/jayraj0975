import { createSign } from 'node:crypto';
import { config } from './config';
import { hmacSha256Hex, safeEqual } from './crypto';
import { HttpError } from './errors';

/**
 * GitHub App integration. Read-only permissions (contents, metadata, pull
 * requests). Installation tokens are minted per job, scoped to one repository,
 * expire in an hour and are never stored.
 */

function b64url(b: Buffer | string): string {
  return Buffer.from(b).toString('base64url');
}

export function appJwt(now = Math.floor(Date.now() / 1000)): string {
  const c = config();
  if (!c.GITHUB_APP_ID || !c.GITHUB_APP_PRIVATE_KEY) throw new HttpError(503, 'GitHub App is not configured on this deployment');
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: c.GITHUB_APP_ID }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  const key = c.GITHUB_APP_PRIVATE_KEY.includes('\\n') ? c.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, '\n') : c.GITHUB_APP_PRIVATE_KEY;
  return `${header}.${payload}.${signer.sign(key).toString('base64url')}`;
}

async function gh<T>(path: string, init: RequestInit & { token?: string; jwt?: boolean } = {}): Promise<T> {
  const c = config();
  const auth = init.jwt ? `Bearer ${appJwt()}` : init.token ? `Bearer ${init.token}` : undefined;
  const res = await fetch(`${c.GITHUB_API_URL}${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'acquicode',
      ...(auth ? { authorization: auth } : {}),
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new HttpError(res.status === 404 ? 404 : 502, `GitHub API ${path.split('?')[0]} returned ${res.status}`);
  return (await res.json()) as T;
}

export interface Installation {
  id: number;
  account: { login: string; type: string };
  suspended_at: string | null;
}

export function getInstallation(id: number): Promise<Installation> {
  return gh<Installation>(`/app/installations/${id}`, { jwt: true });
}

export async function installationToken(installationId: number, repositoryIds?: number[]): Promise<string> {
  const body: Record<string, unknown> = { permissions: { contents: 'read', metadata: 'read', pull_requests: 'read' } };
  if (repositoryIds?.length) body.repository_ids = repositoryIds;
  const r = await gh<{ token: string }>(`/app/installations/${installationId}/access_tokens`, { method: 'POST', jwt: true, body: JSON.stringify(body) });
  return r.token;
}

export interface GhRepo {
  id: number;
  full_name: string;
  default_branch: string;
  clone_url: string;
  private: boolean;
  archived: boolean;
}

export async function listInstallationRepos(token: string): Promise<GhRepo[]> {
  const out: GhRepo[] = [];
  for (let page = 1; page <= 20; page++) {
    const r = await gh<{ repositories: GhRepo[] }>(`/installation/repositories?per_page=100&page=${page}`, { token });
    out.push(...r.repositories);
    if (r.repositories.length < 100) break;
  }
  return out;
}

export function oauthAuthorizeUrl(state: string): string {
  const c = config();
  if (!c.GITHUB_CLIENT_ID) throw new HttpError(503, 'GitHub sign-in is not configured on this deployment');
  const u = new URL('/login/oauth/authorize', c.GITHUB_WEB_URL);
  u.searchParams.set('client_id', c.GITHUB_CLIENT_ID);
  u.searchParams.set('redirect_uri', new URL('/api/auth/github/callback', c.APP_URL).toString());
  u.searchParams.set('state', state);
  u.searchParams.set('allow_signup', 'true');
  return u.toString();
}

/** Exchange an OAuth code for the user's identity. The user token is used once and discarded. */
export async function githubIdentity(code: string): Promise<{ id: number; login: string; name: string | null; email: string | null }> {
  const c = config();
  const res = await fetch(new URL('/login/oauth/access_token', c.GITHUB_WEB_URL), {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'acquicode' },
    body: JSON.stringify({ client_id: c.GITHUB_CLIENT_ID, client_secret: c.GITHUB_CLIENT_SECRET, code, redirect_uri: new URL('/api/auth/github/callback', c.APP_URL).toString() }),
    signal: AbortSignal.timeout(20_000),
  });
  const tok = (await res.json()) as { access_token?: string; error?: string };
  if (!tok.access_token) throw new HttpError(401, `GitHub sign-in failed${tok.error ? `: ${tok.error}` : ''}`);
  const user = await gh<{ id: number; login: string; name: string | null; email: string | null }>('/user', { token: tok.access_token });
  let email = user.email;
  if (!email) {
    try {
      const emails = await gh<Array<{ email: string; primary: boolean; verified: boolean }>>('/user/emails', { token: tok.access_token });
      email = emails.find((e) => e.primary && e.verified)?.email ?? null;
    } catch {
      email = null;
    }
  }
  return { id: user.id, login: user.login, name: user.name, email };
}

export function verifyGithubSignature(body: Buffer, signature: string | null): boolean {
  const secret = config().GITHUB_WEBHOOK_SECRET;
  if (!secret || !signature?.startsWith('sha256=')) return false;
  return safeEqual(signature, `sha256=${hmacSha256Hex(secret, body)}`);
}

export function installUrl(state: string): string {
  const c = config();
  if (!c.GITHUB_APP_SLUG) throw new HttpError(503, 'GitHub App is not configured on this deployment');
  return `${c.GITHUB_WEB_URL}/apps/${encodeURIComponent(c.GITHUB_APP_SLUG)}/installations/new?state=${encodeURIComponent(state)}`;
}
