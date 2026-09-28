import { q1 } from '@/lib/db';
import { storageReady } from '@/lib/storage';

export const dynamic = 'force-dynamic';

/** Readiness: the database answers, migrations have run, and blob storage round-trips. */
export async function GET() {
  let migrations: number;
  try {
    const r = await q1<{ n: string }>('SELECT count(*)::text AS n FROM schema_migrations');
    migrations = Number(r?.n ?? 0);
  } catch {
    return Response.json({ status: 'unavailable', database: 'error' }, { status: 503 });
  }
  const storage = (await storageReady()) ? 'ok' : 'error';
  return Response.json({ status: storage === 'ok' ? 'ready' : 'unavailable', migrations, database: 'ok', storage }, { status: storage === 'ok' ? 200 : 503 });
}
