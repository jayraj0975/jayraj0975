import { encrypt, hashToken, randomToken } from '@/lib/crypto';
import { withOrg } from '@/lib/db';
import { fetchGitlabProject } from '@/lib/gitlab';
import { assertSameOrigin, clientIp, formHandler, HttpError, redirectTo } from '@/lib/http';
import { requireApiContext } from '@/lib/session';
import { assertCanAddRepository } from '@/lib/entitlements';
import { audit } from '@/lib/audit';
import { rateLimit } from '@/lib/ratelimit';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';

export const POST = formHandler(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requireApiContext('admin');
  await rateLimit(`gitlab:${ctx.org.id}`, 20, 3600);
  const form = await req.formData();
  const url = String(form.get('url') ?? '');
  const token = String(form.get('token') ?? '').trim();
  if (!token || token.length > 300) throw new HttpError(400, 'A project access token is required');
  const project = await fetchGitlabProject(url, token);
  const webhookSecret = randomToken('whs', 24);
  const repoId = await withOrg(ctx.org.id, async (c) => {
    await assertCanAddRepository(c, ctx.org.id);
    const r = await c.query<{ id: string }>(
      `INSERT INTO repositories (org_id, provider, external_id, full_name, default_branch, clone_url, webhook_secret_hash)
       VALUES ($1, 'gitlab', $2, $3, $4, $5, $6)
       ON CONFLICT (org_id, provider, full_name) DO UPDATE SET clone_url = EXCLUDED.clone_url, webhook_secret_hash = EXCLUDED.webhook_secret_hash
       RETURNING id`,
      [ctx.org.id, String(project.id), `${project.host}/${project.path}`, project.defaultBranch, project.cloneUrl, hashToken(webhookSecret)],
    );
    const id = r.rows[0]!.id;
    // The credential is bound to its repository id as associated data.
    await c.query('UPDATE repositories SET credential_enc = $2 WHERE id = $1', [id, encrypt(token, `repo:${id}`)]);
    await audit(c, ctx.org.id, { type: 'user', id: ctx.user.id }, 'gitlab.project_connected', { type: 'repository', id }, { project: `${project.host}/${project.path}` }, clientIp(req));
    return id;
  });
  const hook = new URL(`/api/gitlab/webhook/${repoId}`, config().APP_URL).toString();
  return redirectTo(`/app/repos/${repoId}?notice=${encodeURIComponent(`Connected. For continuous mode, add a GitLab push webhook to ${hook} with secret token ${webhookSecret} (shown once).`)}`);
});
