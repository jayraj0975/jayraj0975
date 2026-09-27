import { hashToken, safeEqual } from '@/lib/crypto';
import { isUuid, q1, withOrg } from '@/lib/db';
import { handler, HttpError } from '@/lib/http';
import { queueScan } from '@/lib/jobs';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export const POST = handler(async (req: Request, { params }: { params: Promise<{ repoId: string }> }) => {
  const { repoId } = await params;
  if (!isUuid(repoId)) throw new HttpError(404, 'Not found');
  const org = await q1<{ org: string | null }>('SELECT resolve_repository($1) AS org', [repoId]);
  if (!org?.org) throw new HttpError(404, 'Not found');
  const token = req.headers.get('x-gitlab-token') ?? '';
  const body = await req.text();
  if (body.length > 5 * 1024 * 1024) throw new HttpError(413, 'Payload too large');
  return withOrg(org.org, async (c) => {
    const repo = (await c.query<{ webhook_secret_hash: string | null; monitoring: boolean; default_branch: string | null }>('SELECT webhook_secret_hash, monitoring, default_branch FROM repositories WHERE id = $1', [repoId])).rows[0];
    if (!repo?.webhook_secret_hash || !safeEqual(hashToken(token), repo.webhook_secret_hash)) throw new HttpError(401, 'Invalid token');
    if (req.headers.get('x-gitlab-event') !== 'Push Hook') return Response.json({ status: 'ignored' });
    const p = JSON.parse(body) as { ref?: string };
    if (repo.monitoring && p.ref === `refs/heads/${repo.default_branch}`) {
      const { scanId, deduplicated } = await queueScan(c, org.org!, repoId, 'push', null);
      if (!deduplicated) await audit(c, org.org!, { type: 'webhook', id: 'gitlab' }, 'scan.requested', { type: 'scan', id: scanId }, { trigger: 'push' });
    }
    return Response.json({ status: 'ok' });
  });
});
