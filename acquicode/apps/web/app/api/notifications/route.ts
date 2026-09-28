import { randomUUID } from 'node:crypto';
import { encrypt, randomToken, sealReveal } from '@/lib/crypto';
import { withOrg } from '@/lib/db';
import { assertFeature } from '@/lib/entitlements';
import { assertSameOrigin, clientIp, formHandler, HttpError, redirectTo } from '@/lib/http';
import { resolvePublic } from '@/lib/net';
import { NOTIFY_EVENTS, urlHint } from '@/lib/notify';
import { requireApiContext } from '@/lib/session';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/** Add a webhook endpoint. The URL must be https and resolve to a public address; it is stored encrypted. */
export const POST = formHandler(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requireApiContext('admin');
  const form = await req.formData();
  const raw = String(form.get('url') ?? '').trim();
  const format = String(form.get('format') ?? 'json');
  const events = form.getAll('events').map(String).filter((e): e is (typeof NOTIFY_EVENTS)[number] => (NOTIFY_EVENTS as readonly string[]).includes(e));
  if (format !== 'json' && format !== 'slack') throw new HttpError(400, 'Choose a format');
  if (!events.length) throw new HttpError(400, 'Choose at least one event');
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new HttpError(400, 'Enter the full https URL of the webhook');
  }
  if (u.protocol !== 'https:') throw new HttpError(400, 'Webhook URLs must use https');
  if (u.username || u.password) throw new HttpError(400, 'Do not put credentials in the URL');
  if (raw.length > 2000) throw new HttpError(400, 'That URL is too long');
  await resolvePublic(u.hostname); // refuses internal and private addresses
  const id = randomUUID();
  const secret = randomToken('whsec', 24);
  await withOrg(ctx.org.id, async (c) => {
    await assertFeature(c, ctx.org.id, 'monitoring');
    const n = await c.query<{ n: string }>('SELECT count(*)::text AS n FROM notification_endpoints');
    if (Number(n.rows[0]!.n) >= 10) throw new HttpError(400, 'Remove an endpoint first (limit 10)');
    await c.query(
      'INSERT INTO notification_endpoints (id, org_id, url_enc, url_hint, format, secret_enc, events, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [id, ctx.org.id, encrypt(u.toString(), `notify-url:${id}`), urlHint(u.toString()), format, encrypt(secret, `notify:${id}`), events, ctx.user.id],
    );
    await audit(c, ctx.org.id, { type: 'user', id: ctx.user.id }, 'notification.endpoint_added', { type: 'notification_endpoint', id }, { host: u.host, format, events: events.join(',') }, clientIp(req));
  });
  const reveal = format === 'json' ? `&reveal=${encodeURIComponent(sealReveal(secret, ctx.user.id))}&endpoint=${id}` : '';
  return redirectTo(`/app/settings?notice=${encodeURIComponent('Endpoint added. Send a test to check it.')}${reveal}#notifications`);
});
