import { withOrg } from '@/lib/db';
import { assertSameOrigin, clientIp, formHandler, HttpError, redirectTo } from '@/lib/http';
import { requireApiContext } from '@/lib/session';
import { audit } from '@/lib/audit';
import { q } from '@/lib/db';

export const dynamic = 'force-dynamic';

export const POST = formHandler(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requireApiContext('admin');
  const form = await req.formData();
  const name = String(form.get('name') ?? '').trim().slice(0, 120);
  const retention = Number(form.get('retention_days'));
  const enrichment = form.get('enrichment') === 'on';
  if (!name) throw new HttpError(400, 'Name is required');
  if (!Number.isInteger(retention) || retention < 7 || retention > 3650) throw new HttpError(400, 'Retention must be between 7 and 3650 days');
  await q('UPDATE orgs SET name = $2, retention_days = $3, enrichment_enabled = $4 WHERE id = $1', [ctx.org.id, name, retention, enrichment]);
  await withOrg(ctx.org.id, (c) => audit(c, ctx.org.id, { type: 'user', id: ctx.user.id }, 'settings.updated', { type: 'org', id: ctx.org.id }, { retention, enrichment }, clientIp(req)));
  return redirectTo('/app/settings?notice=Settings saved.');
});
