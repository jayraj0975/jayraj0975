import { hashToken, randomToken, sealReveal } from '@/lib/crypto';
import { withOrg } from '@/lib/db';
import { assertSameOrigin, clientIp, formHandler, HttpError, redirectTo } from '@/lib/http';
import { requireApiContext } from '@/lib/session';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export const POST = formHandler(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requireApiContext('admin');
  const form = await req.formData();
  const name = String(form.get('name') ?? '').trim().slice(0, 80);
  const days = Number(form.get('days') ?? 90);
  if (!name) throw new HttpError(400, 'Give the token a name');
  if (![30, 90, 365].includes(days)) throw new HttpError(400, 'Choose an expiry');
  const token = randomToken('acq', 32);
  await withOrg(ctx.org.id, async (c) => {
    const n = await c.query<{ n: string }>('SELECT count(*)::text AS n FROM api_tokens WHERE revoked_at IS NULL AND request_id IS NULL');
    if (Number(n.rows[0]!.n) >= 20) throw new HttpError(400, 'Revoke unused tokens first (limit 20)');
    const r = await c.query<{ id: string }>("INSERT INTO api_tokens (org_id, name, token_hash, prefix, created_by, expires_at) VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6)) RETURNING id", [ctx.org.id, name, hashToken(token), token.slice(0, 10), ctx.user.id, days]);
    await audit(c, ctx.org.id, { type: 'user', id: ctx.user.id }, 'api_token.created', { type: 'api_token', id: r.rows[0]!.id }, { name, days }, clientIp(req));
  });
  return redirectTo(`/app/settings?reveal=${encodeURIComponent(sealReveal(token, ctx.user.id))}#tokens`);
});
