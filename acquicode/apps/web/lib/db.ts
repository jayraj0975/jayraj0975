import pg from 'pg';
import { config } from './config';

let pool: pg.Pool | null = null;

export function db(): pg.Pool {
  if (pool) return pool;
  const c = config();
  pool = new pg.Pool({
    connectionString: c.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    statement_timeout: 30_000,
    ssl: c.DATABASE_SSL === 'off' ? undefined : { rejectUnauthorized: c.DATABASE_SSL === 'verify' },
  });
  pool.on('error', () => {
    /* idle client errors are surfaced on next use */
  });
  return pool;
}

export type Tx = pg.PoolClient;

/** Run a query outside any tenant context (global tables only: users, sessions, orgs, memberships, jobs). */
export async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await db().query<T>(text, params);
  return res.rows;
}

export async function q1<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T | null> {
  return (await q<T>(text, params))[0] ?? null;
}

export async function tx<T>(fn: (c: Tx) => Promise<T>): Promise<T> {
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v);
}

/**
 * Run `fn` in a transaction scoped to one organisation. Row-level security
 * policies read app.org_id, so every tenant table is filtered by the database
 * itself, not by the query author remembering a WHERE clause.
 */
export async function withOrg<T>(orgId: string, fn: (c: Tx) => Promise<T>): Promise<T> {
  if (!isUuid(orgId)) throw new Error('withOrg: invalid organisation id');
  return tx(async (c) => {
    await c.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
    return fn(c);
  });
}

export async function rows<T extends pg.QueryResultRow = pg.QueryResultRow>(c: Tx, text: string, params: unknown[] = []): Promise<T[]> {
  return (await c.query<T>(text, params)).rows;
}

export async function row<T extends pg.QueryResultRow = pg.QueryResultRow>(c: Tx, text: string, params: unknown[] = []): Promise<T | null> {
  return (await c.query<T>(text, params)).rows[0] ?? null;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
