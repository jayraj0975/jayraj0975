import { isUuid, withOrg } from '@/lib/db';
import { assertSameOrigin, clientIp, formHandler, HttpError, redirectTo } from '@/lib/http';
import { requireApiContext } from '@/lib/session';
import { assertCanAddRepository, assertCanScan } from '@/lib/entitlements';
import { blobs, uploadKey } from '@/lib/storage';
import { enqueue } from '@/lib/jobs';
import { audit } from '@/lib/audit';
import { rateLimit } from '@/lib/ratelimit';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';

/**
 * ZIP upload: stored encrypted only until the worker has analysed it. Without
 * git history, ownership and AI-development sections are reported as UNKNOWN.
 */
export const POST = formHandler(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requireApiContext('member');
  await rateLimit(`upload:${ctx.org.id}`, 30, 3600);
  const max = config().MAX_UPLOAD_MB * 1024 * 1024;
  if (Number(req.headers.get('content-length') ?? '0') > max + 64 * 1024) throw new HttpError(413, `Archives are limited to ${config().MAX_UPLOAD_MB} MB`);
  const form = await req.formData();
  const file = form.get('archive');
  const nameRaw = String(form.get('name') ?? '').trim();
  const repoIdRaw = String(form.get('repositoryId') ?? '');
  if (!(file instanceof File) || file.size === 0) throw new HttpError(400, 'Choose a ZIP archive');
  if (file.size > max) throw new HttpError(413, `Archives are limited to ${config().MAX_UPLOAD_MB} MB`);
  const data = Buffer.from(await file.arrayBuffer());
  if (data.subarray(0, 4).toString('hex') !== '504b0304') throw new HttpError(400, 'That file is not a ZIP archive');
  const name = (nameRaw || file.name.replace(/\.zip$/i, '')).replace(/[^A-Za-z0-9._/-]+/g, '-').slice(0, 120) || 'upload';
  const { scanId, repoId } = await withOrg(ctx.org.id, async (c) => {
    let repoId: string;
    if (isUuid(repoIdRaw)) {
      const r = await c.query<{ id: string }>("SELECT id FROM repositories WHERE id = $1 AND provider = 'upload'", [repoIdRaw]);
      if (!r.rows[0]) throw new HttpError(404, 'Repository not found');
      repoId = r.rows[0].id;
    } else {
      const existing = await c.query<{ id: string }>("SELECT id FROM repositories WHERE provider = 'upload' AND full_name = $1", [name]);
      if (existing.rows[0]) repoId = existing.rows[0].id;
      else {
        await assertCanAddRepository(c, ctx.org.id);
        repoId = (await c.query<{ id: string }>("INSERT INTO repositories (org_id, provider, full_name) VALUES ($1, 'upload', $2) RETURNING id", [ctx.org.id, name])).rows[0]!.id;
      }
    }
    await assertCanScan(c, ctx.org.id);
    const s = await c.query<{ id: string }>("INSERT INTO scans (org_id, repository_id, trigger, created_by) VALUES ($1, $2, 'upload', $3) RETURNING id", [ctx.org.id, repoId, ctx.user.id]);
    const scanId = s.rows[0]!.id;
    await blobs().put(uploadKey(ctx.org.id, scanId), data);
    await c.query('UPDATE scans SET upload_key = $2 WHERE id = $1', [scanId, uploadKey(ctx.org.id, scanId)]);
    await enqueue(c, ctx.org.id, 'scan', { scanId });
    await audit(c, ctx.org.id, { type: 'user', id: ctx.user.id }, 'upload.received', { type: 'scan', id: scanId }, { bytes: data.length, repository: name }, clientIp(req));
    return { scanId, repoId };
  });
  void repoId;
  return redirectTo(`/app/scans/${scanId}`);
});
