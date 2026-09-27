import { NextResponse } from 'next/server';
import { q, withOrg } from '@/lib/db';
import { assertSameOrigin, clientIp, formHandler, HttpError } from '@/lib/http';
import { ORG_COOKIE, requireApiContext } from '@/lib/session';
import { blobs } from '@/lib/storage';
import { config } from '@/lib/config';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';

/** Irreversible: removes every repository, dossier body, declaration, link, token and audit row of the organisation. */
export const POST = formHandler(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requireApiContext('owner');
  const form = await req.formData();
  if (String(form.get('confirm') ?? '') !== ctx.org.name) throw new HttpError(400, 'Type the organisation name to confirm');
  const keys = await withOrg(ctx.org.id, async (c) => (await c.query<{ storage_key: string }>('SELECT storage_key FROM dossiers')).rows.map((r) => r.storage_key));
  const uploads = await withOrg(ctx.org.id, async (c) => (await c.query<{ upload_key: string }>('SELECT upload_key FROM scans WHERE upload_key IS NOT NULL')).rows.map((r) => r.upload_key));
  for (const k of [...keys, ...uploads]) await blobs().delete(k).catch(() => undefined);
  await q('DELETE FROM jobs WHERE org_id = $1', [ctx.org.id]);
  await q('DELETE FROM orgs WHERE id = $1', [ctx.org.id]);
  log().info({ orgId: ctx.org.id, actor: ctx.user.id, ip: clientIp(req), dossiers: keys.length }, 'organisation deleted');
  const res = NextResponse.redirect(new URL('/app', config().APP_URL), 303);
  res.cookies.delete(ORG_COOKIE);
  return res;
});
