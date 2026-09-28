import YAML from 'yaml';
import { DeclarationError, parseRegisterCsv, sha256Hex } from '@acquicode/engine';
import { isUuid, withOrg } from '@/lib/db';
import { assertSameOrigin, clientIp, formHandler, HttpError, redirectTo } from '@/lib/http';
import { requireApiContext } from '@/lib/session';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/** Merge an uploaded IP register CSV into a new version of the repository's declarations. */
export const POST = formHandler(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const { id } = await params;
  if (!isUuid(id)) throw new HttpError(404, 'Not found');
  const ctx = await requireApiContext('member');
  const form = await req.formData();
  const file = form.get('register');
  if (!(file instanceof File) || file.size === 0) throw new HttpError(400, 'Choose a CSV file');
  if (file.size > 2 * 1024 * 1024) throw new HttpError(413, 'Register is limited to 2 MB');
  let entries;
  try {
    entries = parseRegisterCsv(await file.text());
  } catch (err) {
    if (err instanceof DeclarationError) return redirectTo(`/app/repos/${id}?tab=declarations&error=${encodeURIComponent(`Register not imported: ${err.message}`)}`);
    throw err;
  }
  await withOrg(ctx.org.id, async (c) => {
    const prev = await c.query<{ content: string }>('SELECT content FROM declarations WHERE repository_id = $1 ORDER BY created_at DESC LIMIT 1', [id]);
    const doc = (prev.rows[0] ? YAML.parse(prev.rows[0].content) : {}) ?? {};
    doc.contributors = entries.map((e) => ({ ...(e.email ? { email: e.email } : {}), ...(e.name ? { name: e.name } : {}), agreement: e.agreement, ...(e.signedOn ? { signed_on: e.signedOn } : {}), ...(e.entity ? { entity: e.entity } : {}) }));
    const content = YAML.stringify(doc);
    const r = await c.query<{ id: string }>('INSERT INTO declarations (org_id, repository_id, content, digest, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id', [ctx.org.id, id, content, sha256Hex(content), ctx.user.id]);
    await audit(c, ctx.org.id, { type: 'user', id: ctx.user.id }, 'register.imported', { type: 'declarations', id: r.rows[0]!.id }, { entries: entries.length }, clientIp(req));
  });
  return redirectTo(`/app/repos/${id}?tab=declarations&notice=${encodeURIComponent(`Imported ${entries.length} register entries into a new declarations version.`)}`);
});
