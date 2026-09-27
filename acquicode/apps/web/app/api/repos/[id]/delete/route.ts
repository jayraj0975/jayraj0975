import { isUuid, withOrg } from '@/lib/db';
import { assertSameOrigin, clientIp, formHandler, HttpError, redirectTo } from '@/lib/http';
import { requireApiContext } from '@/lib/session';
import { blobs } from '@/lib/storage';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/** Hard delete: scans, dossiers (and their encrypted bodies), declarations, events, share links. */
export const POST = formHandler(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const { id } = await params;
  if (!isUuid(id)) throw new HttpError(404, 'Not found');
  const ctx = await requireApiContext('admin');
  const form = await req.formData();
  const name = await withOrg(ctx.org.id, async (c) => {
    const repo = (await c.query<{ full_name: string }>('SELECT full_name FROM repositories WHERE id = $1', [id])).rows[0];
    if (!repo) throw new HttpError(404, 'Not found');
    if (String(form.get('confirm') ?? '') !== repo.full_name) throw new HttpError(400, 'Type the repository name to confirm deletion');
    const keys = await c.query<{ storage_key: string }>('SELECT d.storage_key FROM dossiers d JOIN scans s ON s.id = d.scan_id WHERE s.repository_id = $1', [id]);
    for (const k of keys.rows) await blobs().delete(k.storage_key);
    await c.query('DELETE FROM repositories WHERE id = $1', [id]);
    await audit(c, ctx.org.id, { type: 'user', id: ctx.user.id }, 'repository.deleted', { type: 'repository', id }, { name: repo.full_name, dossiers: keys.rowCount }, clientIp(req));
    return repo.full_name;
  });
  return redirectTo(`/app?notice=${encodeURIComponent(`Deleted ${name} and all of its data.`)}`);
});
