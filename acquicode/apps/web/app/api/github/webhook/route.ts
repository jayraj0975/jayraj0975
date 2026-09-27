import { q1, withOrg } from '@/lib/db';
import { verifyGithubSignature } from '@/lib/github';
import { handler, HttpError } from '@/lib/http';
import { queueScan } from '@/lib/jobs';
import { audit } from '@/lib/audit';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';

interface Payload {
  action?: string;
  installation?: { id: number; account?: { login: string } };
  repository?: { id: number; full_name: string; default_branch: string };
  repositories_added?: Array<{ id: number; full_name: string }>;
  repositories_removed?: Array<{ id: number; full_name: string }>;
  ref?: string;
  after?: string;
  deleted?: boolean;
}

export const POST = handler(async (req: Request) => {
  const body = Buffer.from(await req.arrayBuffer());
  if (body.length > 5 * 1024 * 1024) throw new HttpError(413, 'Payload too large');
  if (!verifyGithubSignature(body, req.headers.get('x-hub-signature-256'))) throw new HttpError(401, 'Invalid signature');
  const delivery = req.headers.get('x-github-delivery') ?? '';
  const event = req.headers.get('x-github-event') ?? '';
  if (delivery) {
    const fresh = await q1("INSERT INTO webhook_deliveries (source, delivery_id) VALUES ('github', $1) ON CONFLICT DO NOTHING RETURNING 1", [delivery.slice(0, 100)]);
    if (!fresh) return Response.json({ status: 'duplicate' });
  }
  const p = JSON.parse(body.toString('utf8')) as Payload;
  const installationId = p.installation?.id;
  if (!installationId) return Response.json({ status: 'ignored' });
  const org = await q1<{ org: string | null }>('SELECT resolve_installation($1) AS org', [installationId]);
  if (!org?.org) return Response.json({ status: 'unknown installation' });
  const orgId = org.org;
  const actor = { type: 'webhook' as const, id: `github:${delivery}` };

  if (event === 'installation') {
    await withOrg(orgId, async (c) => {
      if (p.action === 'deleted') {
        await c.query('UPDATE repositories SET installation_id = NULL, monitoring = false WHERE installation_id = $1', [installationId]);
        await c.query('DELETE FROM github_installations WHERE installation_id = $1', [installationId]);
      } else if (p.action === 'suspend') {
        await c.query('UPDATE github_installations SET suspended_at = now() WHERE installation_id = $1', [installationId]);
      } else if (p.action === 'unsuspend') {
        await c.query('UPDATE github_installations SET suspended_at = NULL WHERE installation_id = $1', [installationId]);
      }
      await audit(c, orgId, actor, `github.installation_${p.action ?? 'event'}`, { type: 'installation', id: String(installationId) });
    });
  } else if (event === 'installation_repositories') {
    await withOrg(orgId, async (c) => {
      for (const r of p.repositories_removed ?? []) {
        await c.query("UPDATE repositories SET installation_id = NULL, monitoring = false WHERE provider = 'github' AND external_id = $1", [String(r.id)]);
      }
      for (const r of p.repositories_added ?? []) {
        await c.query(
          `UPDATE repositories SET installation_id = $2 WHERE provider = 'github' AND external_id = $1`,
          [String(r.id), installationId],
        );
      }
      await audit(c, orgId, actor, 'github.repositories_changed', { type: 'installation', id: String(installationId) }, { added: (p.repositories_added ?? []).length, removed: (p.repositories_removed ?? []).length });
    });
  } else if (event === 'push' && p.repository && !p.deleted) {
    const branch = p.ref?.replace(/^refs\/heads\//, '');
    if (branch && branch === p.repository.default_branch) {
      await withOrg(orgId, async (c) => {
        const repo = await c.query<{ id: string; monitoring: boolean }>("SELECT id, monitoring FROM repositories WHERE provider = 'github' AND external_id = $1", [String(p.repository!.id)]);
        const r = repo.rows[0];
        if (r?.monitoring) {
          const { scanId, deduplicated } = await queueScan(c, orgId, r.id, 'push', null);
          if (!deduplicated) await audit(c, orgId, actor, 'scan.requested', { type: 'scan', id: scanId }, { trigger: 'push', commit: p.after?.slice(0, 40) ?? null });
        }
      });
    }
  } else if (event === 'repository' && p.repository && (p.action === 'renamed' || p.action === 'transferred')) {
    await withOrg(orgId, async (c) => {
      const res = await c.query("UPDATE repositories SET full_name = $2 WHERE provider = 'github' AND external_id = $1 RETURNING id", [String(p.repository!.id), p.repository!.full_name]);
      if (res.rowCount) await audit(c, orgId, actor, 'repository.moved', { type: 'repository', id: (res.rows[0] as { id: string }).id }, { fullName: p.repository!.full_name, action: p.action });
    });
  }
  log().info({ event, action: p.action, orgId }, 'github webhook processed');
  return Response.json({ status: 'ok' });
});
