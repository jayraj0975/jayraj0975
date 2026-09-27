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
  const scanId = await withOrg(ctx.org.id, async (c) => {
    const r = await c.query<{ scan_id: string }>('UPDATE share_links SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING scan_id', [id]);
    if (!r.rows[0]) throw new HttpError(404, 'Link not found or already revoked');
    await audit(c, ctx.org.id, { type: 'user', id: ctx.user.id }, 'share_link.revoked', { type: 'share_link', id }, {}, clientIp(req));
    return r.rows[0].scan_id;
  });
  return redirectTo(`/app/scans/${scanId}?notice=${encodeURIComponent('Share link revoked. It stops working immediately.')}`);
});
