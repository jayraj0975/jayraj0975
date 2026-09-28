import { isUuid, withOrg } from '@/lib/db';
import { assertSameOrigin, clientIp, formHandler, HttpError, redirectTo } from '@/lib/http';
import { requireApiContext } from '@/lib/session';
import { assertFeature } from '@/lib/entitlements';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export const POST = formHandler(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const { id } = await params;
  if (!isUuid(id)) throw new HttpError(404, 'Not found');
  const ctx = await requireApiContext('admin');
  const form = await req.formData();
  const enable = form.get('enable') === '1';
  await withOrg(ctx.org.id, async (c) => {
    if (enable) await assertFeature(c, ctx.org.id, 'monitoring');
    const r = await c.query("UPDATE repositories SET monitoring = $2 WHERE id = $1 AND provider IN ('github', 'gitlab')", [id, enable]);
    if (!r.rowCount) throw new HttpError(400, 'Monitoring is available for GitHub and GitLab repositories');
    await audit(c, ctx.org.id, { type: 'user', id: ctx.user.id }, enable ? 'monitoring.enabled' : 'monitoring.disabled', { type: 'repository', id }, {}, clientIp(req));
  });
  return redirectTo(`/app/repos/${id}?notice=${encodeURIComponent(enable ? 'Continuous monitoring enabled: every push to the default branch, plus a daily re-check, produces a new snapshot.' : 'Monitoring disabled.')}`);
});
