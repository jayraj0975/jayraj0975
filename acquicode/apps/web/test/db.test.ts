/**
 * Tenant isolation at the database, not just in application code. The schema
 * is migrated by a NON-superuser owner (as on RDS / Cloud SQL) and queried as
 * the unprivileged application role. Requires PostgreSQL with a superuser at
 * TEST_DATABASE_ADMIN_URL to create the roles; skips otherwise.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import pg from 'pg';
import { migrate } from '../scripts/migrate';

const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const suffix = randomBytes(4).toString('hex');
const dbName = `acquicode_rls_${suffix}`;
const ownerRole = `acq_owner_${suffix}`;
const appRole = `acq_app_${suffix}`;
const badRole = `acq_bad_${suffix}`;
const url = (role: string) => ADMIN_URL.replace(/\/\/[^@]+@/, `//${role}:pw@`).replace(/\/[^/]*$/, `/${dbName}`);
const MIGRATIONS = join(resolve(__dirname, '..'), 'db/migrations');

let available = false;
try {
  const c = new pg.Client({ connectionString: ADMIN_URL, connectionTimeoutMillis: 2000 });
  await c.connect();
  await c.end();
  available = true;
} catch {
  available = false;
}
if (!available) console.warn(`db tests skipped: no PostgreSQL at ${ADMIN_URL}`);

let app: pg.Client;
let owner: pg.Client;
const ids: Record<string, string> = {};

async function asOrg<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
  await app.query('BEGIN');
  try {
    await app.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
    const out = await fn();
    await app.query('COMMIT');
    return out;
  } catch (err) {
    await app.query('ROLLBACK');
    throw err;
  }
}

beforeAll(async () => {
  if (!available) return;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`CREATE ROLE ${ownerRole} LOGIN PASSWORD 'pw' NOSUPERUSER NOBYPASSRLS`);
  await admin.query(`CREATE ROLE ${appRole} LOGIN PASSWORD 'pw' NOSUPERUSER NOBYPASSRLS`);
  await admin.query(`CREATE ROLE ${badRole} LOGIN PASSWORD 'pw' NOSUPERUSER BYPASSRLS`);
  await admin.query(`CREATE DATABASE ${dbName} OWNER ${ownerRole}`);
  await admin.end();
  expect(await migrate(url(ownerRole), appRole, MIGRATIONS)).toEqual(['001_init.sql', '002_definer_access.sql', '003_invitations_by_id.sql']);
  app = new pg.Client({ connectionString: url(appRole) });
  owner = new pg.Client({ connectionString: url(ownerRole) });
  await Promise.all([app.connect(), owner.connect()]);

  // Global tables: no org context needed.
  ids.user = (await app.query("INSERT INTO users (github_id, login) VALUES (1, 'ana') RETURNING id")).rows[0].id;
  ids.orgA = (await app.query("INSERT INTO orgs (name) VALUES ('A') RETURNING id")).rows[0].id;
  ids.orgB = (await app.query("INSERT INTO orgs (name) VALUES ('B') RETURNING id")).rows[0].id;
  for (const org of ['A', 'B'] as const) {
    const orgId = ids[`org${org}`]!;
    await asOrg(orgId, async () => {
      const repo = (await app.query("INSERT INTO repositories (org_id, provider, full_name, monitoring) VALUES ($1, 'github', $2, $3) RETURNING id", [orgId, `${org}/repo`, org === 'B'])).rows[0].id;
      const scan = (await app.query("INSERT INTO scans (org_id, repository_id, trigger) VALUES ($1, $2, 'manual') RETURNING id", [orgId, repo])).rows[0].id;
      await app.query("INSERT INTO share_links (org_id, scan_id, token_hash, label, expires_at) VALUES ($1, $2, $3, 'x', now() + interval '1 day')", [orgId, scan, `share-${org}`]);
      await app.query("INSERT INTO api_tokens (org_id, name, token_hash, prefix) VALUES ($1, 'ci', $2, 'acq_x')", [orgId, `token-${org}`]);
      await app.query("INSERT INTO audit_events (org_id, actor_type, action) VALUES ($1, 'system', 'test.event')", [orgId]);
      ids[`repo${org}`] = repo;
    });
  }
  await asOrg(ids.orgB!, () => app.query("INSERT INTO invitations (org_id, github_login, github_id, role) VALUES ($1, 'ana', 1, 'member')", [ids.orgB]));
  // Same login, different account (a renamed and re-registered username): must never be claimable by user 1.
  await asOrg(ids.orgA!, () => app.query("INSERT INTO invitations (org_id, github_login, github_id, role) VALUES ($1, 'ana', 999, 'admin')", [ids.orgA]));
}, 60_000);

afterAll(async () => {
  if (!available) return;
  await app?.end();
  await owner?.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  for (const r of [ownerRole, appRole, badRole]) await admin.query(`DROP ROLE IF EXISTS ${r}`);
  await admin.end();
});

describe.skipIf(!available)('tenant isolation in PostgreSQL', () => {
  it('migrations are idempotent', async () => {
    expect(await migrate(url(ownerRole), appRole, MIGRATIONS)).toEqual([]);
  });

  it('refuses an application role that could bypass row-level security', async () => {
    await expect(migrate(url(ownerRole), badRole, MIGRATIONS)).rejects.toThrow(/BYPASSRLS/);
    await expect(migrate(url(ownerRole), ownerRole, MIGRATIONS)).rejects.toThrow(/must not own/);
  });

  it('shows nothing without an organisation context', async () => {
    for (const t of ['repositories', 'scans', 'share_links', 'api_tokens', 'audit_events', 'invitations']) {
      expect((await app.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n, t).toBe(0);
    }
  });

  it('shows one organisation only its own rows and refuses cross-tenant writes', async () => {
    await asOrg(ids.orgA!, async () => {
      const repos = await app.query('SELECT full_name FROM repositories');
      expect(repos.rows.map((r) => r.full_name)).toEqual(['A/repo']);
      const upd = await app.query("UPDATE repositories SET full_name = 'pwned' WHERE id = $1", [ids.repoB]);
      expect(upd.rowCount).toBe(0);
      const del = await app.query('DELETE FROM api_tokens WHERE org_id = $1', [ids.orgB]);
      expect(del.rowCount).toBe(0);
    });
    await expect(asOrg(ids.orgA!, () => app.query("INSERT INTO repositories (org_id, provider, full_name) VALUES ($1, 'upload', 'smuggled')", [ids.orgB]))).rejects.toThrow(/row-level security/);
  });

  it('keeps the table owner inside the policy too (FORCE ROW LEVEL SECURITY)', async () => {
    expect((await owner.query('SELECT count(*)::int AS n FROM scans')).rows[0].n).toBe(0);
  });

  it('resolves pre-authentication lookups through narrow definer functions, even with a non-superuser owner', async () => {
    expect((await app.query('SELECT * FROM resolve_share_link($1)', ['share-A'])).rows[0]?.org_id).toBe(ids.orgA);
    expect((await app.query('SELECT * FROM resolve_api_token($1)', ['token-B'])).rows[0]?.org_id).toBe(ids.orgB);
    expect((await app.query('SELECT resolve_repository($1) AS org', [ids.repoA])).rows[0].org).toBe(ids.orgA);
    expect((await app.query('SELECT * FROM resolve_share_link($1)', ['nope'])).rowCount).toBe(0);
    expect((await app.query('SELECT repository_id FROM monitored_repositories()')).rows.map((r) => r.repository_id)).toEqual([ids.repoB]);
    expect((await app.query('SELECT claim_invitations($1, $2) AS n', [1, ids.user])).rows[0].n).toBe(1);
    expect((await app.query('SELECT org_id, role FROM memberships WHERE user_id = $1', [ids.user])).rows).toEqual([{ org_id: ids.orgB, role: 'member' }]);
  });

  it('keeps the audit trail append-only', async () => {
    await expect(asOrg(ids.orgA!, () => app.query("UPDATE audit_events SET action = 'x'"))).rejects.toThrow(/permission denied/);
    await expect(asOrg(ids.orgA!, () => app.query('DELETE FROM audit_events'))).rejects.toThrow(/permission denied/);
    await owner.query('BEGIN');
    await owner.query("SELECT set_config('app.org_id', $1, true)", [ids.orgA]);
    await expect(owner.query("UPDATE audit_events SET action = 'x'")).rejects.toThrow(/append-only|immutable/i);
    await owner.query('ROLLBACK');
  });

  it('keeps definer functions away from other database roles', async () => {
    const r = await owner.query("SELECT has_function_privilege('public', 'resolve_share_link(text)', 'EXECUTE') AS pub, has_function_privilege($1, 'resolve_share_link(text)', 'EXECUTE') AS app", [appRole]);
    expect(r.rows[0]).toEqual({ pub: false, app: true });
  });

  it('gives the application role no way to create objects', async () => {
    await expect(app.query('CREATE TABLE sneaky (id int)')).rejects.toThrow(/permission denied/);
  });
});
