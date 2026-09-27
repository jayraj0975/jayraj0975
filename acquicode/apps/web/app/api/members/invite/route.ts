import { withOrg } from '@/lib/db';
import { assertSameOrigin, clientIp, formHandler, HttpError, redirectTo } from '@/lib/http';
import { requireApiContext } from '@/lib/session';
import { audit } from '@/lib/audit';
import { q, q1 } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Invite by GitHub login. If the person already has an account they join immediately; otherwise on first sign-in. */
export const POST = formHandler(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requireApiContext('admin');
  const form = await req.formData();
  const login = String(form.get('login') ?? '').trim().replace(/^@/, '');
  const role = String(form.get('role') ?? 'member');
  if (!/^[A-Za-z0-9-]{1,39}$/.test(login)) throw new HttpError(400, 'Enter a GitHub username');
  if (!['admin', 'member', 'viewer'].includes(role)) throw new HttpError(400, 'Invalid role');
  if (role === 'admin' && ctx.role !== 'owner') throw new HttpError(403, 'Only owners can invite admins');
  const user = await q1<{ id: string }>('SELECT id FROM users WHERE lower(login) = lower($1)', [login]);
  if (user) await q('INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (org_id, user_id) DO NOTHING', [ctx.org.id, user.id, role]);
  await withOrg(ctx.org.id, async (c) => {
    if (!user) await c.query('INSERT INTO invitations (org_id, github_login, role, created_by) VALUES ($1, $2, $3, $4) ON CONFLICT (org_id, github_login) DO UPDATE SET role = EXCLUDED.role', [ctx.org.id, login, role, ctx.user.id]);
    await audit(c, ctx.org.id, { type: 'user', id: ctx.user.id }, 'member.invited', { type: 'user', id: login }, { role, immediate: !!user }, clientIp(req));
  });
  return redirectTo(`/app/settings?notice=${encodeURIComponent(user ? `${login} added as ${role}.` : `${login} will join as ${role} when they first sign in.`)}#members`);
});
