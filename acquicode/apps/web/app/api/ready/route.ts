import { q1 } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Readiness: the database answers and migrations have run. */
export async function GET() {
  try {
    const r = await q1<{ n: string }>('SELECT count(*)::text AS n FROM schema_migrations');
    return Response.json({ status: 'ready', migrations: Number(r?.n ?? 0) });
  } catch {
    return Response.json({ status: 'unavailable' }, { status: 503 });
  }
}
