import { isUuid, withOrg } from '@/lib/db';
import { assertSameOrigin, clientIp, formHandler, HttpError, redirectTo } from '@/lib/http';
import { requireApiContext } from '@/lib/session';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/** Cancel a request: its token stops working immediately. Dossiers already delivered are kept. */
export const POST = formHandler(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const { id } = await params;
  if (!isUuid(id)) throw new HttpError(404, 'Not found');
  const ctx = await requireApiContext('member');
  await withOrg(ctx.org.id, async (c) => {
    const r = await c.query<{ token_id: string | null }>("UPDATE dossier_requests SET status = 'cancelled' WHERE id = $1 AND status <> 'cancelled' RETURNING token_id", [id]);
    if (!r.rowCount) throw new HttpError(404, 'Request not found');
    await c.query('UPDATE api_tokens SET revoked_at = now() WHERE request_id = $1 AND revoked_at IS NULL', [id]);
    await audit(c, ctx.org.id, { type: 'user', id: ctx.user.id }, 'request.cancelled', { type: 'request', id }, {}, clientIp(req));
  });
  return redirectTo('/app/requests?notice=Request cancelled; its token no longer works.');
});
