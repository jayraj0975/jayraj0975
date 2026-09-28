import { isUuid, withOrg } from '@/lib/db';
import { assertSameOrigin, formHandler, HttpError, redirectTo } from '@/lib/http';
import { appLink, enqueueDelivery } from '@/lib/notify';
import { rateLimit } from '@/lib/ratelimit';
import { requireApiContext } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const POST = formHandler(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const { id } = await params;
  if (!isUuid(id)) throw new HttpError(404, 'Not found');
  const ctx = await requireApiContext('admin');
  await rateLimit(`notify-test:${ctx.org.id}`, 20, 3600);
  await withOrg(ctx.org.id, async (c) => {
    const ep = await c.query('SELECT 1 FROM notification_endpoints WHERE id = $1', [id]);
    if (!ep.rowCount) throw new HttpError(404, 'Endpoint not found');
    await enqueueDelivery(c, ctx.org.id, id, 'test', {
      organisation: { id: ctx.org.id, name: ctx.org.name },
      url: appLink('/app/settings#notifications'),
      message: `Test notification for ${ctx.org.name}. If you can read this, AcquiCode notifications reach this endpoint.`,
    });
  });
  return redirectTo('/app/settings?notice=Test queued. The result appears next to the endpoint within a minute.#notifications');
});
