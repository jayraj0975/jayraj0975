import { isUuid, withOrg } from '@/lib/db';
import { assertSameOrigin, clientIp, formHandler, HttpError, redirectTo } from '@/lib/http';
import { queueScan } from '@/lib/jobs';
import { requireApiContext } from '@/lib/session';
import { assertCanScan } from '@/lib/entitlements';
import { audit } from '@/lib/audit';
import { rateLimit } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

export const POST = formHandler(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const { id } = await params;
  if (!isUuid(id)) throw new HttpError(404, 'Not found');
  const ctx = await requireApiContext('member');
  await rateLimit(`scan:${ctx.org.id}`, 60, 3600);
  const form = await req.formData().catch(() => null);
  const ref = form ? String(form.get('ref') ?? '').trim() : '';
  if (ref && !/^[A-Za-z0-9._/-]{1,200}$/.test(ref)) throw new HttpError(400, 'Invalid ref');
  const scanId = await withOrg(ctx.org.id, async (c) => {
    const repo = (await c.query<{ provider: string; installation_id: string | null }>('SELECT provider, installation_id FROM repositories WHERE id = $1', [id])).rows[0];
    if (!repo) throw new HttpError(404, 'Not found');
    if (repo.provider === 'cli') throw new HttpError(400, 'This repository is analysed with the CLI; push a new dossier from where the code lives.');
    if (repo.provider === 'upload') throw new HttpError(400, 'Upload a new archive to re-analyse an uploaded repository.');
    if (repo.provider === 'github' && !repo.installation_id) throw new HttpError(400, 'The GitHub App no longer has access to this repository. Reinstall it from Add source.');
    await assertCanScan(c, ctx.org.id);
    const { scanId } = await queueScan(c, ctx.org.id, id, 'manual', ctx.user.id, ref || null);
    await audit(c, ctx.org.id, { type: 'user', id: ctx.user.id }, 'scan.requested', { type: 'scan', id: scanId }, { trigger: 'manual', ref: ref || null }, clientIp(req));
    return scanId;
  });
  return redirectTo(`/app/scans/${scanId}`);
});
