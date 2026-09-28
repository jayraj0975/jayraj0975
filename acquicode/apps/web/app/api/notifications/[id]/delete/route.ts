import { isUuid, withOrg } from '@/lib/db';
import { assertSameOrigin, clientIp, formHandler, HttpError, redirectTo } from '@/lib/http';
import { requireApiContext } from '@/lib/session';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export const POST = formHandler(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const { id } = await params;
  if (!isUuid(id)) throw new HttpError(404, 'Not found');
  const ctx = await requireApiContext('admin');
  await withOrg(ctx.org.id, async (c) => {
    const r = await c.query('DELETE FROM notification_endpoints WHERE id = $1', [id]);
    if (!r.rowCount) throw new HttpError(404, 'Endpoint not found');
    await audit(c, ctx.org.id, { type: 'user', id: ctx.user.id }, 'notification.endpoint_removed', { type: 'notification_endpoint', id }, {}, clientIp(req));
  });
  return redirectTo('/app/settings?notice=Endpoint removed.#notifications');
});
