import { DeclarationError, parseDeclarations, sha256Hex } from '@acquicode/engine';
import { isUuid, withOrg } from '@/lib/db';
import { assertSameOrigin, clientIp, formHandler, HttpError, redirectTo } from '@/lib/http';
import { requireApiContext } from '@/lib/session';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/** Declarations are company assertions. Every save is a new version; nothing is overwritten. */
export const POST = formHandler(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const { id } = await params;
  if (!isUuid(id)) throw new HttpError(404, 'Not found');
  const ctx = await requireApiContext('member');
  const form = await req.formData();
  const content = String(form.get('content') ?? '');
  if (content.length > 1024 * 1024) throw new HttpError(413, 'Declarations are limited to 1 MB');
  try {
    parseDeclarations(content, 'workspace');
  } catch (err) {
    if (err instanceof DeclarationError) return redirectTo(`/app/repos/${id}?tab=declarations&error=${encodeURIComponent(`Not saved: ${err.message}`)}`);
    throw err;
  }
  await withOrg(ctx.org.id, async (c) => {
    const repo = await c.query('SELECT 1 FROM repositories WHERE id = $1', [id]);
    if (!repo.rowCount) throw new HttpError(404, 'Not found');
    const r = await c.query<{ id: string }>('INSERT INTO declarations (org_id, repository_id, content, digest, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id', [ctx.org.id, id, content, sha256Hex(content), ctx.user.id]);
    await audit(c, ctx.org.id, { type: 'user', id: ctx.user.id }, 'declarations.saved', { type: 'declarations', id: r.rows[0]!.id }, { repository: id }, clientIp(req));
  });
  return redirectTo(`/app/repos/${id}?tab=declarations&notice=${encodeURIComponent('Declarations saved as a new version. They apply from the next scan and are shown as company-asserted.')}`);
});
