import { hashToken, randomToken } from '@/lib/crypto';
import { isUuid, withOrg } from '@/lib/db';
import { assertSameOrigin, clientIp, formHandler, HttpError, redirectTo } from '@/lib/http';
import { requireApiContext } from '@/lib/session';
import { assertFeature } from '@/lib/entitlements';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/** Create a read-only link for a buyer or counsel. The token is shown once and stored only as a hash. */
export const POST = formHandler(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const { id } = await params;
  if (!isUuid(id)) throw new HttpError(404, 'Not found');
  const ctx = await requireApiContext('admin');
  const form = await req.formData();
  const label = String(form.get('label') ?? '').trim().slice(0, 120) || 'Shared dossier';
  const days = Math.min(Math.max(Number(form.get('days') ?? 30) || 30, 1), 180);
  const token = randomToken('shr', 24);
  await withOrg(ctx.org.id, async (c) => {
    await assertFeature(c, ctx.org.id, 'shareLinks');
    const scan = await c.query("SELECT 1 FROM scans s JOIN dossiers d ON d.scan_id = s.id WHERE s.id = $1 AND s.status = 'succeeded'", [id]);
    if (!scan.rowCount) throw new HttpError(400, 'Only completed dossiers can be shared');
    const r = await c.query<{ id: string }>("INSERT INTO share_links (org_id, scan_id, token_hash, label, expires_at, created_by) VALUES ($1, $2, $3, $4, now() + make_interval(days => $5), $6) RETURNING id", [ctx.org.id, id, hashToken(token), label, days, ctx.user.id]);
    await audit(c, ctx.org.id, { type: 'user', id: ctx.user.id }, 'share_link.created', { type: 'share_link', id: r.rows[0]!.id }, { scan: id, label, days }, clientIp(req));
  });
  return redirectTo(`/app/scans/${id}?share=${encodeURIComponent(token)}`);
});
