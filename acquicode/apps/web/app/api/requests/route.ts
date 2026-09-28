import { hashToken, randomToken, sealReveal } from '@/lib/crypto';
import { withOrg } from '@/lib/db';
import { assertSameOrigin, clientIp, formHandler, HttpError, redirectTo } from '@/lib/http';
import { requireApiContext } from '@/lib/session';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/**
 * Create a dossier request for a target. The request gets its own token that can
 * only deliver dossiers into this organisation, is linked to this request, and
 * expires with it. The token is shown to the requester once.
 */
export const POST = formHandler(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requireApiContext('member');
  const form = await req.formData();
  const target = String(form.get('target') ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
  const note = String(form.get('note') ?? '').trim().slice(0, 2000) || null;
  const days = Number(form.get('days') ?? 30);
  if (!target) throw new HttpError(400, 'Name the company you are requesting a dossier from');
  if (![7, 30, 90].includes(days)) throw new HttpError(400, 'Choose how long the request stays open');
  const token = randomToken('acq', 32);
  const id = await withOrg(ctx.org.id, async (c) => {
    const open = await c.query<{ n: string }>("SELECT count(*)::text AS n FROM dossier_requests WHERE status = 'open' AND expires_at > now()");
    if (Number(open.rows[0]!.n) >= 50) throw new HttpError(400, 'Cancel or close some open requests first (limit 50)');
    const r = await c.query<{ id: string }>(
      "INSERT INTO dossier_requests (org_id, target, note, created_by, expires_at) VALUES ($1, $2, $3, $4, now() + make_interval(days => $5)) RETURNING id",
      [ctx.org.id, target, note, ctx.user.id, days],
    );
    const requestId = r.rows[0]!.id;
    const t = await c.query<{ id: string }>(
      "INSERT INTO api_tokens (org_id, name, token_hash, prefix, created_by, expires_at, request_id) VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6), $7) RETURNING id",
      [ctx.org.id, `Request: ${target}`, hashToken(token), token.slice(0, 10), ctx.user.id, days, requestId],
    );
    await c.query('UPDATE dossier_requests SET token_id = $2 WHERE id = $1', [requestId, t.rows[0]!.id]);
    await audit(c, ctx.org.id, { type: 'user', id: ctx.user.id }, 'request.created', { type: 'request', id: requestId }, { target, days }, clientIp(req));
    return requestId;
  });
  return redirectTo(`/app/requests?created=${id}&reveal=${encodeURIComponent(sealReveal(token, ctx.user.id))}`);
});
