import { isUuid, q, q1, withOrg } from '@/lib/db';
import { assertSameOrigin, clientIp, formHandler, HttpError, redirectTo } from '@/lib/http';
import { requireApiContext } from '@/lib/session';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export const POST = formHandler(async (req: Request, { params }: { params: Promise<{ userId: string }> }) => {
  assertSameOrigin(req);
  const { userId } = await params;
  if (!isUuid(userId)) throw new HttpError(404, 'Not found');
  const ctx = await requireApiContext('admin');
  const target = await q1<{ role: string }>('SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2', [ctx.org.id, userId]);
  if (!target) throw new HttpError(404, 'Not a member');
  if (target.role === 'owner') {
    const owners = await q1<{ n: string }>("SELECT count(*)::text AS n FROM memberships WHERE org_id = $1 AND role = 'owner'", [ctx.org.id]);
    if (ctx.role !== 'owner' || Number(owners?.n) <= 1) throw new HttpError(400, 'An organisation needs at least one owner');
  }
  await q('DELETE FROM memberships WHERE org_id = $1 AND user_id = $2', [ctx.org.id, userId]);
  await withOrg(ctx.org.id, (c) => audit(c, ctx.org.id, { type: 'user', id: ctx.user.id }, 'member.removed', { type: 'user', id: userId }, {}, clientIp(req)));
  return redirectTo('/app/settings?notice=Member removed.#members');
});
