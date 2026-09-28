import type { Tx } from './db';

export type AuditActor = { type: 'user' | 'token' | 'share_link' | 'system' | 'webhook'; id: string | null };

/** Append-only audit trail (the table rejects updates). Written inside the caller's tenant transaction. */
export async function audit(
  c: Tx,
  orgId: string | null,
  actor: AuditActor,
  action: string,
  target: { type: string; id: string } | null = null,
  meta: Record<string, unknown> = {},
  ip: string | null = null,
): Promise<void> {
  await c.query(
    'INSERT INTO audit_events (org_id, actor_type, actor_id, action, target_type, target_id, ip, meta) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [orgId, actor.type, actor.id, action, target?.type ?? null, target?.id ?? null, ip, JSON.stringify(meta)],
  );
}
