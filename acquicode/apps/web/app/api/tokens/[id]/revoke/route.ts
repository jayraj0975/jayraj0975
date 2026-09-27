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
    const r = await c.query('UPDATE api_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [id]);
    if (!r.rowCount) throw new HttpError(404, 'Token not found');
    await audit(c, ctx.org.id, { type: 'user', id: ctx.user.id }, 'api_token.revoked', { type: 'api_token', id }, {}, clientIp(req));
  });
  return redirectTo('/app/settings?notice=Token revoked.#tokens');
});
