import { verifyState } from '@/lib/crypto';
import { getInstallation, installationToken, listInstallationRepos } from '@/lib/github';
import { clientIp, formHandler, redirectTo } from '@/lib/http';
import { requireApiContext, hasRole } from '@/lib/session';
import { withOrg } from '@/lib/db';
import { audit } from '@/lib/audit';
import { effectivePlan } from '@/lib/entitlements';

export const dynamic = 'force-dynamic';

/** GitHub redirects here after the App is installed or its repository selection changes. */
export const GET = formHandler(async (req: Request) => {
  const url = new URL(req.url);
  const ctx = await requireApiContext('viewer');
  const state = verifyState<{ purpose: string; org: string; user: string }>(url.searchParams.get('state'));
  const installationId = Number(url.searchParams.get('installation_id'));
  if (!state || state.purpose !== 'install' || state.user !== ctx.user.id) return redirectTo('/app/connect?error=The installation link expired or belongs to another session. Start again from Add source.');
  if (state.org !== ctx.org.id || !hasRole(ctx, 'admin')) return redirectTo('/app/connect?error=Only an admin of this organisation can connect GitHub.');
  if (!Number.isSafeInteger(installationId) || installationId <= 0) return redirectTo('/app/connect?error=GitHub did not return an installation id.');
  const inst = await getInstallation(installationId);
  const token = await installationToken(installationId);
  const repos = (await listInstallationRepos(token)).filter((r) => !r.archived);
  const added = await withOrg(ctx.org.id, async (c) => {
    const taken = await c.query('SELECT 1 FROM github_installations WHERE installation_id = $1', [installationId]);
    if (!taken.rowCount) {
      await c.query('INSERT INTO github_installations (installation_id, org_id, account_login, account_type) VALUES ($1, $2, $3, $4) ON CONFLICT (installation_id) DO NOTHING', [installationId, ctx.org.id, inst.account.login, inst.account.type]);
    }
    const plan = await effectivePlan(c, ctx.org.id);
    const existing = Number((await c.query<{ n: string }>('SELECT count(*)::text AS n FROM repositories')).rows[0]!.n);
    let room = plan.limits.repositories - existing;
    let n = 0;
    for (const r of repos) {
      const res = await c.query(
        `INSERT INTO repositories (org_id, provider, external_id, full_name, default_branch, clone_url, installation_id)
         SELECT $1, 'github', $2, $3, $4, $5, $6 WHERE $7 > 0
         ON CONFLICT (org_id, provider, full_name) DO UPDATE SET installation_id = EXCLUDED.installation_id, default_branch = EXCLUDED.default_branch, external_id = EXCLUDED.external_id
         RETURNING (xmax = 0) AS inserted`,
        [ctx.org.id, String(r.id), r.full_name, r.default_branch, r.clone_url, installationId, room],
      );
      if (res.rows[0]?.inserted) {
        n++;
        room--;
      }
    }
    await audit(c, ctx.org.id, { type: 'user', id: ctx.user.id }, 'github.installation_connected', { type: 'installation', id: String(installationId) }, { account: inst.account.login, repositories: repos.length, added: n }, clientIp(req));
    return { n, skipped: repos.length - n };
  });
  return redirectTo(`/app?notice=${encodeURIComponent(`Connected ${inst.account.login}: ${added.n} repositor${added.n === 1 ? 'y' : 'ies'} added${added.skipped ? ` (${added.skipped} already present or over the plan limit)` : ''}. Choose one and run a scan.`)}`);
});
