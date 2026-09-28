import { checkInvariants, dossierDigest, verifyEnvelope, type Dossier, type DsseEnvelope } from '@acquicode/engine';
import { hashToken } from '@/lib/crypto';
import { q, q1, withOrg } from '@/lib/db';
import { clientIp, handler, HttpError, readJsonBody } from '@/lib/http';
import { rateLimit } from '@/lib/ratelimit';
import { storeDossier } from '@/lib/dossiers';
import { assertCanAddRepository } from '@/lib/entitlements';
import { audit } from '@/lib/audit';
import { appLink, emit } from '@/lib/notify';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';

/**
 * CLI push: a dossier produced where the code lives. No source code is
 * received. The dossier must satisfy its own evidence invariants; a supplied
 * envelope must verify against the key inside it (recorded as SELF_ATTESTED).
 */
export const POST = handler(async (req: Request) => {
  const auth = req.headers.get('authorization') ?? '';
  const token = /^Bearer (acq_[A-Za-z0-9_-]{20,80})$/.exec(auth)?.[1];
  if (!token) throw new HttpError(401, 'Bearer API token required');
  await rateLimit(`api:${hashToken(token).slice(0, 16)}`, 120, 3600);
  const t = await q1<{ org_id: string; token_id: string; scopes: string[]; request_id: string | null }>('SELECT * FROM resolve_api_token($1)', [hashToken(token)]);
  if (!t || !t.scopes.includes('dossiers:write')) throw new HttpError(401, 'Invalid or revoked token');
  const body = await readJsonBody<{ dossier?: Dossier; envelope?: DsseEnvelope | null; publicKey?: string }>(req, 80 * 1024 * 1024);
  const d = body.dossier;
  if (!d || d.schema !== 'acquicode.dossier/1' || !Array.isArray(d.subjects) || !d.subjects.length) throw new HttpError(400, 'Body must contain an AcquiCode dossier');
  const violations = checkInvariants(d);
  if (violations.length) throw new HttpError(422, `Dossier violates its evidence rules: ${violations.slice(0, 3).join('; ')}`);
  let keyid: string | null = null;
  if (body.envelope) {
    if (!body.publicKey) throw new HttpError(400, 'A signed dossier needs the signer publicKey (PEM) so it can be verified');
    const r = verifyEnvelope(body.envelope, [body.publicKey], d);
    if (!r.signatureValid || !r.dossierMatches) throw new HttpError(422, `Signature check failed: ${r.problems.join('; ')}`);
    keyid = r.keyid;
  }
  const name = d.subjects.length === 1 ? d.subjects[0]!.name : d.title;
  // A dossier delivered against a request is filed under that request's target, so two targets'
  // repositories with the same name never merge.
  const request = t.request_id
    ? await withOrg(t.org_id, (c) => c.query<{ target: string; status: string }>('SELECT target, status FROM dossier_requests WHERE id = $1', [t.request_id]).then((r) => r.rows[0] ?? null))
    : null;
  if (t.request_id && (!request || request.status === 'cancelled')) throw new HttpError(410, 'This dossier request was cancelled by the requester');
  const prefix = request ? `${request.target.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60)}/` : '';
  const safeName = `${prefix}${name.replace(/[^A-Za-z0-9._/-]+/g, '-').slice(0, 160)}` || 'cli';
  const { repoId, scanId } = await withOrg(t.org_id, async (c) => {
    let repo = (await c.query<{ id: string }>("SELECT id FROM repositories WHERE provider = 'cli' AND full_name = $1", [safeName])).rows[0];
    if (!repo) {
      await assertCanAddRepository(c, t.org_id);
      repo = (await c.query<{ id: string }>("INSERT INTO repositories (org_id, provider, full_name) VALUES ($1, 'cli', $2) RETURNING id", [t.org_id, safeName])).rows[0]!;
    }
    const s = await c.query<{ id: string }>("INSERT INTO scans (org_id, repository_id, trigger, status, started_at, commit_sha) VALUES ($1, $2, 'cli', 'running', now(), $3) RETURNING id", [t.org_id, repo.id, d.subjects[0]?.headCommit ?? null]);
    await audit(c, t.org_id, { type: 'token', id: t.token_id }, 'dossier.pushed', { type: 'scan', id: s.rows[0]!.id }, { digest: dossierDigest(d), signed: !!body.envelope }, clientIp(req));
    return { repoId: repo.id, scanId: s.rows[0]!.id };
  });
  await withOrg(t.org_id, (c) => c.query('UPDATE api_tokens SET last_used_at = now() WHERE id = $1', [t.token_id]));
  await storeDossier(t.org_id, repoId, scanId, d, Buffer.from(JSON.stringify(d)), 'SELF_ATTESTED', body.envelope ?? null, keyid);
  if (t.request_id) {
    await withOrg(t.org_id, async (c) => {
      await c.query("UPDATE dossier_requests SET status = 'received', scan_id = $2, received_at = now(), deliveries = deliveries + 1 WHERE id = $1", [t.request_id, scanId]);
      await audit(c, t.org_id, { type: 'token', id: t.token_id }, 'request.received', { type: 'request', id: t.request_id! }, { scan: scanId, signed: !!keyid, readiness: d.readiness.level }, clientIp(req));
      const org = await c.query<{ name: string }>('SELECT name FROM orgs WHERE id = $1', [t.org_id]);
      await emit(c, t.org_id, 'request.received', {
        organisation: { id: t.org_id, name: org.rows[0]?.name ?? '' },
        repository: { id: repoId, name: safeName },
        scan: { id: scanId, readiness: d.readiness.level },
        request: { id: t.request_id!, target: request!.target },
        url: appLink(`/app/scans/${scanId}`),
        message: `Dossier received from ${request!.target} (${name}): ${d.readiness.level}, ${keyid ? 'signed' : 'not signed'}.`,
      });
    });
  }
  return Response.json({ scan: scanId, digest: dossierDigest(d), readiness: d.readiness.level, url: new URL(`/app/scans/${scanId}`, config().APP_URL).toString() }, { status: 201 });
});
