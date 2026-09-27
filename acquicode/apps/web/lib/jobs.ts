import type { Tx } from './db';

export type JobKind = 'scan' | 'purge' | 'schedule';

export async function enqueue(c: Tx, orgId: string | null, kind: JobKind, payload: Record<string, unknown>, runAfterSeconds = 0): Promise<number> {
  const r = await c.query<{ id: string }>(
    "INSERT INTO jobs (org_id, kind, payload, run_after) VALUES ($1, $2, $3, now() + make_interval(secs => $4)) RETURNING id",
    [orgId, kind, JSON.stringify(payload), runAfterSeconds],
  );
  return Number(r.rows[0]!.id);
}

/**
 * Queue a scan unless one is already waiting for the same repository (pushes
 * in quick succession collapse into one analysis of the latest commit).
 */
export async function queueScan(
  c: Tx,
  orgId: string,
  repositoryId: string,
  trigger: 'manual' | 'push' | 'schedule' | 'upload',
  createdBy: string | null,
  ref: string | null = null,
): Promise<{ scanId: string; deduplicated: boolean }> {
  if (trigger !== 'upload') {
    const pending = await c.query<{ id: string }>("SELECT id FROM scans WHERE repository_id = $1 AND status = 'queued' ORDER BY created_at DESC LIMIT 1", [repositoryId]);
    if (pending.rows[0]) return { scanId: pending.rows[0].id, deduplicated: true };
  }
  const s = await c.query<{ id: string }>('INSERT INTO scans (org_id, repository_id, trigger, ref, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id', [orgId, repositoryId, trigger, ref, createdBy]);
  const scanId = s.rows[0]!.id;
  await enqueue(c, orgId, 'scan', { scanId });
  return { scanId, deduplicated: false };
}
