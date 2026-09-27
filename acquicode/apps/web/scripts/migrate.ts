import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';

/**
 * Applies db/migrations/*.sql in order, each in its own transaction, and
 * grants the application role the minimum it needs. Runs as the migration
 * (owner) role; the app role never owns tables and cannot bypass RLS.
 */
export async function migrate(url: string, appRole: string, dir = join(process.cwd(), 'db/migrations')): Promise<string[]> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const applied: string[] = [];
  try {
    const role = await client.query<{ rolsuper: boolean; rolbypassrls: boolean; is_owner: boolean; member_of_owner: boolean }>(
      'SELECT rolsuper, rolbypassrls, rolname = current_user AS is_owner, pg_has_role(rolname, current_user, \'MEMBER\') AS member_of_owner FROM pg_roles WHERE rolname = $1',
      [appRole],
    );
    const info = role.rows[0];
    if (info) {
      // Tenant isolation depends on these; refuse rather than run with a role that silently bypasses it.
      if (info.rolsuper || info.rolbypassrls) throw new Error(`application role ${appRole} must not be SUPERUSER or BYPASSRLS`);
      if (info.is_owner || info.member_of_owner) throw new Error(`application role ${appRole} must not own the schema or be a member of the migration role`);
    }
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    await client.query('SELECT pg_advisory_lock(727272)');
    const done = new Set((await client.query<{ version: string }>('SELECT version FROM schema_migrations')).rows.map((r) => r.version));
    const files = (await readdir(dir)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = await readFile(join(dir, f), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [f]);
        await client.query('COMMIT');
        applied.push(f);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${f} failed: ${(err as Error).message}`);
      }
    }
    if (info) {
      const r = client.escapeIdentifier(appRole);
      await client.query(`REVOKE CREATE ON SCHEMA public FROM ${r}`);
      await client.query(`GRANT USAGE ON SCHEMA public TO ${r}`);
      await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${r}`);
      await client.query(`REVOKE UPDATE, DELETE ON audit_events FROM ${r}`);
      await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${r}`);
      await client.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${r}`);
    }
    await client.query('SELECT pg_advisory_unlock(727272)');
  } finally {
    await client.end();
  }
  return applied;
}

const isMain = process.argv[1] && /migrate\.(ts|mjs|js)$/.test(process.argv[1]);
if (isMain) {
  const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write('DATABASE_MIGRATION_URL or DATABASE_URL is required\n');
    process.exit(1);
  }
  migrate(url, process.env.APP_DB_ROLE ?? 'acquicode_app').then(
    (applied) => {
      process.stdout.write(applied.length ? `applied ${applied.join(', ')}\n` : 'database is up to date\n');
      process.exit(0);
    },
    (err: Error) => {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    },
  );
}
