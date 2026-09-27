import { withOrg } from '@/lib/db';
import { assertSameOrigin, clientIp, formHandler, HttpError, redirectTo } from '@/lib/http';
import { requireApiContext } from '@/lib/session';
import { audit } from '@/lib/audit';
import { q, q1 } from '@/lib/db';
import { resolveGithubLogin } from '@/lib/github';
import { devLoginEnabled } from '@/lib/config';

export const dynamic = 'force-dynamic';

/**
 * Invite by GitHub username, bound to the account's numeric id at invite time
 * (usernames can change hands). Existing users join immediately; others on first sign-in.
 */
export const POST = formHandler(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requireApiContext('admin');
  const form = await req.formData();
  const login = String(form.get('login') ?? '').trim().replace(/^@/, '');
  const role = String(form.get('role') ?? 'member');
  if (!/^[A-Za-z0-9-]{1,39}$/.test(login)) throw new HttpError(400, 'Enter a GitHub username');
  if (!['admin', 'member', 'viewer'].includes(role)) throw new HttpError(400, 'Invalid role');
  if (role === 'admin' && ctx.role !== 'owner') throw new HttpError(403, 'Only owners can invite admins');
  const gh = await resolveGithubLogin(login, devLoginEnabled());
  const user = await q1<{ id: string }>('SELECT id FROM users WHERE github_id = $1', [gh.id]);
  if (user) await q('INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (org_id, user_id) DO NOTHING', [ctx.org.id, user.id, role]);
  await withOrg(ctx.org.id, async (c) => {
    if (!user) await c.query('INSERT INTO invitations (org_id, github_login, github_id, role, created_by) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (org_id, github_id) DO UPDATE SET role = EXCLUDED.role, github_login = EXCLUDED.github_login', [ctx.org.id, gh.login, gh.id, role, ctx.user.id]);
    await audit(c, ctx.org.id, { type: 'user', id: ctx.user.id }, 'member.invited', { type: 'github_user', id: String(gh.id) }, { login: gh.login, role, immediate: !!user }, clientIp(req));
  });
  return redirectTo(`/app/settings?notice=${encodeURIComponent(user ? `${gh.login} added as ${role}.` : `${gh.login} will join as ${role} when they first sign in.`)}#members`);
});
