import { audit } from './audit';
import { q1, withOrg } from './db';
import { effectivePlan } from './entitlements';
import { HttpError } from './errors';
import { getInstallation, installationToken, listInstallationRepos } from './github';
import type { OrgContext } from './session';

/**
 * Bind a GitHub App installation to an organisation and register its
 * repositories. Callers must already have verified that the signed-in user can
 * access the installation on GitHub (see githubIdentityWithInstallations).
 * An installation belongs to at most one organisation.
 */
export async function connectInstallation(ctx: OrgContext, installationId: number, ip: string): Promise<{ account: string; added: number; skipped: number }> {
  const bound = await q1<{ org: string | null }>('SELECT resolve_installation($1) AS org', [installationId]);
  if (bound?.org && bound.org !== ctx.org.id) {
    throw new HttpError(409, 'This GitHub installation is already connected to another AcquiCode organisation. Remove it there first, or install the App on a different account.');
  }
  const inst = await getInstallation(installationId);
  const token = await installationToken(installationId);
  const repos = (await listInstallationRepos(token)).filter((r) => !r.archived);
  return withOrg(ctx.org.id, async (c) => {
    await c.query('INSERT INTO github_installations (installation_id, org_id, account_login, account_type) VALUES ($1, $2, $3, $4) ON CONFLICT (installation_id) DO NOTHING', [installationId, ctx.org.id, inst.account.login, inst.account.type]);
    const owned = await c.query('SELECT 1 FROM github_installations WHERE installation_id = $1', [installationId]);
    // Lost a race with another organisation binding the same installation.
    if (!owned.rowCount) throw new HttpError(409, 'This GitHub installation is already connected to another AcquiCode organisation.');
    const plan = await effectivePlan(c, ctx.org.id);
    const existing = Number((await c.query<{ n: string }>('SELECT count(*)::text AS n FROM repositories')).rows[0]!.n);
    let room = plan.limits.repositories - existing;
    let added = 0;
    for (const r of repos) {
      const res = await c.query(
        `INSERT INTO repositories (org_id, provider, external_id, full_name, default_branch, clone_url, installation_id)
         SELECT $1, 'github', $2, $3, $4, $5, $6 WHERE $7 > 0
         ON CONFLICT (org_id, provider, full_name) DO UPDATE SET installation_id = EXCLUDED.installation_id, default_branch = EXCLUDED.default_branch, external_id = EXCLUDED.external_id
         RETURNING (xmax = 0) AS inserted`,
        [ctx.org.id, String(r.id), r.full_name, r.default_branch, r.clone_url, installationId, room],
      );
      if (res.rows[0]?.inserted) {
        added++;
        room--;
      }
    }
    await audit(c, ctx.org.id, { type: 'user', id: ctx.user.id }, 'github.installation_connected', { type: 'installation', id: String(installationId) }, { account: inst.account.login, repositories: repos.length, added }, ip);
    return { account: inst.account.login, added, skipped: repos.length - added };
  });
}
